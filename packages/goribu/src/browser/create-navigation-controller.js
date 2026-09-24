import { applyDocumentMeta } from "./apply-document-meta.js";
import { loadClientPage } from "./load-client-page.js";
import { readNavigationEnvelope } from "./read-navigation-envelope.js";
import { createLocatedPage } from "../navigation/location-context.js";
import { createStaticNavigation } from "./static-navigation.js";

const NAVIGATION_PATH = "/_goribu/worker-nav";
const HISTORY_KEY = "__goribu";
const PREFETCH_DELAY_MS = 80;
const PREFETCH_MAX_AGE_MS = 10_000;
const SCROLL_SAVE_DELAY_MS = 100;
const MAX_CACHE_ENTRIES = 20;
const MAX_REDIRECTS = 8;

/**
 * Own browser navigation after initial hydration.
 *
 * The controller fetches saved static payloads or the Worker endpoint, resolves
 * pages through the generated route-ID loader map, and commits history/UI only after both payload
 * and page module are known-good. Every uncertain path falls back to a document
 * load instead of leaving partially committed client state.
 */
export function createNavigationController(options) {
  const root = options?.root;
  const pageLoaders = options?.pageLoaders;
  const browserWindow = options?.browserWindow ?? globalThis.window;
  const fetchImplementation = options?.fetch ?? globalThis.fetch;
  const applyMeta =
    options?.applyMeta ??
    ((metadata) => applyDocumentMeta(metadata, browserWindow.document));

  assertControllerInputs({
    root,
    pageLoaders,
    browserWindow,
    fetchImplementation,
    applyMeta,
  });
  const navigationBuildId = options?.navigationBuildId ?? null;
  const staticNavigation = navigationBuildId === null ? null : createStaticNavigation({
    buildId: navigationBuildId, fetch: fetchImplementation,
    origin: browserWindow.location.origin, pageLoaders,
  });
  // Discover confirmed output once, without blocking hydration or swallowing a
  // click. Failed discovery is retried by navigation and otherwise stays silent.
  void staticNavigation?.ready().catch(() => {});

  const cache = new Map();
  const scheduledPrefetches = new Map();
  // Per-entry scroll positions, keyed by history-entry id. Intentionally
  // unbounded, unlike `cache`: it is cleared on dispose and on any full document
  // load, and a missing entry falls back to the coordinates mirrored in
  // history.state, so it self-corrects without an eviction policy.
  const scrollByHistoryEntry = new Map();
  let navigationVersion = 0;
  let nextHistoryEntryId = 0;
  let currentHistoryEntryId = null;
  let renderedUrl = new URL(browserWindow.location.href);
  let scrollSaveTimer = null;
  let disposed = false;
  let cancelPendingCommit = null;
  let pendingRender = null;

  installInitialHistoryState();
  const previousScrollRestoration = browserWindow.history.scrollRestoration;
  browserWindow.history.scrollRestoration = "manual";
  browserWindow.addEventListener("popstate", handlePopState);
  browserWindow.addEventListener("hashchange", handleHashChange);
  browserWindow.addEventListener("scroll", scheduleScrollSave);
  browserWindow.addEventListener("pagehide", saveCurrentScroll);

  const controller = Object.freeze({
    navigate,
    renderInPlace,
    captureVersion: () => navigationVersion,
    prefetch,
    schedulePrefetch,
    cancelPrefetch,
    saveScroll: saveCurrentScroll,
    dispose,
  });
  return controller;

  async function navigate(target, navigationOptions = undefined) {
    assertTarget(target);
    const replace = resolveReplace(navigationOptions);
    const signal = resolveNavigationSignal(navigationOptions);
    if (signal?.aborted === true) return;

    const destination = resolveHttpDestination(target);
    if (destination === null) {
      throw new TypeError(
        `[Goribu] Cannot navigate to ${JSON.stringify(target)} because it is not a valid HTTP(S) URL or path. Pass a same-origin application path or an HTTP(S) document URL.`,
      );
    }
    // External document loads also supersede pending page and Form work.
    const version = beginNavigation();
    if (destination.origin !== browserWindow.location.origin) {
      if (signal?.aborted === true) return;
      return hardLoad(destination.href, replace);
    }

    if (
      isSameDocumentHash(destination) &&
      hasSameRouteLocation(destination, renderedUrl) &&
      pendingRender === null
    ) {
      saveCurrentScroll();
      if (signal?.aborted === true) return;
      try {
        commitHistory(destination, replace || destination.href === renderedUrl.href ? "replace" : "push");
        renderedUrl = destination;
      } catch (error) {
        logNavigationFailure(destination, error);
        return hardLoad(destination.href, replace);
      }
      if (disposed || version !== navigationVersion || signal?.aborted === true) return;
      scrollToDestination(destination);
      saveCurrentScroll();
      return;
    }

    saveCurrentScroll();
    // Back/Forward changes the browser URL before its page finishes loading.
    // History decisions must use that URL, not the page still on screen.
    const sameUrl = destination.href === browserWindow.location.href;
    return performNavigation(destination, {
      version,
      historyMode: replace || sameUrl ? "replace" : "push",
      redirectDepth: 0,
      restoreScroll: null,
      signal,
      refresh: sameUrl,
    });
  }

  async function renderInPlace(
    routeId,
    props,
    metadata,
    renderOptions = undefined,
  ) {
    const signal = resolveNavigationSignal(renderOptions);
    const expectedVersion = resolveExpectedVersion(renderOptions) ?? navigationVersion;
    if (
      signal?.aborted === true ||
      disposed ||
      expectedVersion !== navigationVersion
    ) {
      return false;
    }
    if (typeof routeId !== "string" || routeId.length === 0) {
      throw new TypeError(
        "[Goribu] Form render requires the non-empty canonical route ID from the negotiated response envelope.",
      );
    }
    if (!isPlainObject(props)) {
      throw new TypeError(
        "[Goribu] Form render requires page props to be a plain object from the negotiated response envelope.",
      );
    }

    const Page = await loadClientPage({ routeId, pageLoaders });
    if (
      signal?.aborted === true ||
      disposed ||
      expectedVersion !== navigationVersion
    ) {
      return false;
    }

    applyMeta(metadata);
    const location = browserWindow.location.href;
    const context = {
      version: expectedVersion,
      signal,
    };
    try {
      return await renderAndCommit(Page, props, location, context);
    } catch (error) {
      if (disposed || context.version !== navigationVersion || context.signal?.aborted) return false;
      // The failed page may already have unmounted its submitting Form. Own
      // recovery here instead of asking that Form to complete another effect.
      const destination = resolveHttpDestination(renderOptions?.recoveryUrl ?? location);
      if (destination === null || destination.origin !== browserWindow.location.origin) {
        throw new TypeError("[Goribu] Form render recovery requires a same-origin HTTP(S) document URL. Pass the submitted action URL through the Form runtime.");
      }
      destination.hash = "";
      const replace = renderOptions?.replace === undefined ? true : resolveReplace(renderOptions);
      logNavigationFailure(destination, error);
      await hardLoad(destination.href, replace);
      return false;
    }
  }

  function beginNavigation() {
    navigationVersion += 1;
    cancelPendingCommit?.();
    return navigationVersion;
  }

  function renderAndCommit(Page, props, location, context, commit = () => {}) {
    cancelPendingCommit?.();
    return new Promise((resolve, reject) => {
      let settled = false;
      let committed = false;
      let failed = false;
      const render = {};
      function cleanup() {
        if (settled) return false;
        settled = true;
        if (cancelPendingCommit === cancel) cancelPendingCommit = null;
        context.signal?.removeEventListener?.("abort", cancel);
        return true;
      }
      function cancel() {
        if (cleanup()) resolve(false);
      }
      function onCommitStart() {
        if (settled || disposed || context.version !== navigationVersion || context.signal?.aborted) return;
        // React is committing the response. Its own Form removal must not
        // cancel completion or recovery from a later error in this commit.
        // Loading/suspended renders retain the signal; navigation/disposal win.
        context.signal?.removeEventListener?.("abort", cancel);
        context.signal = null;
      }
      function fail(error) {
        failed = true;
        if (pendingRender === render) pendingRender = null;
        if (!cleanup()) return false;
        reject(error);
        return true;
      }
      function onCommit() {
        if (failed) return;
        // Cancellation settles the caller, but cannot unschedule React work.
        // Track what actually committed separately from who still owns scrolling.
        if (!committed) {
          committed = true;
          renderedUrl = new URL(location);
          if (pendingRender === render) pendingRender = null;
        }
        if (settled) return;
        if (disposed || context.version !== navigationVersion || context.signal?.aborted) {
          cancel();
          return;
        }
        try {
          commit();
          if (cleanup()) resolve(true);
        } catch (error) {
          // Keep navigation failures on the native-load fallback path, rather
          // than throwing them into the application's React error boundary.
          fail(error);
        }
      }
      cancelPendingCommit = cancel;
      context.signal?.addEventListener?.("abort", cancel, { once: true });
      if (disposed || context.version !== navigationVersion || context.signal?.aborted) {
        cancel();
        return;
      }
      try {
        pendingRender = render;
        root.render(createLocatedPage(Page, props, location, onCommit, fail, onCommitStart));
      } catch (error) {
        fail(error);
      }
    });
  }

  async function performNavigation(destination, context) {
    try {
      if (staticNavigation !== null) {
        const entry = await staticNavigation.lookup(destination);
        if (disposed || context.version !== navigationVersion || context.signal?.aborted) return;
        if (entry !== null) {
          destination.pathname = entry.pathname;
          if (
            context.refresh &&
            pendingRender === null &&
            destination.href === renderedUrl.href &&
            destination.href === browserWindow.location.href
          ) {
            scrollToDestination(destination);
            saveCurrentScroll();
            return;
          }
        }
      }
      const target = await consumeTarget(destination, context.refresh);
      if (
        disposed ||
        context.version !== navigationVersion ||
        context.signal?.aborted === true
      ) {
        return;
      }

      if (target.envelope.kind === "reload") {
        if (context.signal?.aborted === true) return;
        await hardLoad(destination.href, context.historyMode !== "push");
        return;
      }

      if (target.envelope.kind === "redirect") {
        if (context.redirectDepth >= MAX_REDIRECTS) {
          throw new Error(
            `[Goribu] Client navigation exceeded ${MAX_REDIRECTS} redirects. Check route redirect handlers for a loop.`,
          );
        }
        const redirected = resolveHttpDestination(
          target.envelope.location,
          destination,
        );
        if (redirected === null) {
          if (context.signal?.aborted === true) return;
          await hardLoad(destination.href, context.historyMode !== "push");
          return;
        }
        if (
          destination.hash.length > 0 &&
          !target.envelope.location.includes("#")
        ) {
          // Match document redirect behavior: an omitted fragment inherits the
          // original one, including through trailing-slash canonicalization.
          redirected.hash = destination.hash;
        }
        if (redirected.origin !== browserWindow.location.origin) {
          if (context.signal?.aborted === true) return;
          await hardLoad(redirected.href, context.historyMode !== "push");
          return;
        }
        return performNavigation(redirected, {
          ...context,
          historyMode:
            context.historyMode === "none" ? "replace" : context.historyMode,
          redirectDepth: context.redirectDepth + 1,
        });
      }

      if (context.signal?.aborted === true) return;
      commitHistory(destination, context.historyMode);
      // The accepted destination now belongs to navigation, not the source
      // Form: committing it can unmount that Form and abort its submission.
      // Newer navigation and disposal still supersede this commit. The Form's
      // signal continues to cancel work while fetching/loading, before here.
      // A fallback replaces this accepted entry, including after a push, so a
      // failed render never leaves an extra broken entry in Back/Forward.
      context = { ...context, historyMode: "replace", signal: null };
      applyMeta(target.envelope.meta);
      await renderAndCommit(target.Page, target.envelope.props, destination.href, context, () => {
        if (context.restoreScroll !== null) {
          browserWindow.scrollTo(context.restoreScroll.x, context.restoreScroll.y);
        } else {
          scrollToDestination(destination);
        }
        saveCurrentScroll();
      });
    } catch (error) {
      if (
        disposed ||
        context.version !== navigationVersion ||
        context.signal?.aborted === true
      ) {
        return;
      }
      logNavigationFailure(destination, error);
      await hardLoad(destination.href, context.historyMode !== "push");
    }
  }

  async function prefetch(target) {
    if (disposed || typeof target !== "string" || target.length === 0) return;
    const destination = resolveHttpDestination(target);
    if (
      destination === null ||
      destination.origin !== browserWindow.location.origin ||
      isSameDocumentHash(destination) || destination.href === renderedUrl.href
    ) {
      return;
    }

    try {
      await warmTarget(destination);
    } catch {
      // Prefetch is an optional hint. A later navigation retries and owns fallback.
    }
  }

  function schedulePrefetch(target) {
    if (disposed || typeof target !== "string" || target.length === 0) return;
    cancelPrefetch(target);
    const timer = browserWindow.setTimeout(() => {
      scheduledPrefetches.delete(target);
      void prefetch(target);
    }, PREFETCH_DELAY_MS);
    scheduledPrefetches.set(target, timer);
  }

  function cancelPrefetch(target) {
    const timer = scheduledPrefetches.get(target);
    if (timer === undefined) return;
    browserWindow.clearTimeout(timer);
    scheduledPrefetches.delete(target);
  }

  function handlePopState(event) {
    const version = beginNavigation();
    cancelScheduledScrollSave();
    activateHistoryEntry(event.state);
    const destination = resolveHttpDestination(browserWindow.location.href);
    if (
      destination === null ||
      destination.origin !== browserWindow.location.origin
    ) {
      void hardLoad(browserWindow.location.href, true);
      return;
    }

    const staysOnCurrentDocument = pendingRender === null && hasSameRouteLocation(destination, renderedUrl);
    const restoreScroll = readScrollState(event.state, scrollByHistoryEntry);
    if (staysOnCurrentDocument) {
      renderedUrl = destination;
      void restoreSameDocumentHistory(destination, restoreScroll, version);
      return;
    }

    void performNavigation(destination, {
      version,
      historyMode: "none",
      redirectDepth: 0,
      restoreScroll,
    });
  }

  function handleHashChange() {
    const destination = resolveHttpDestination(browserWindow.location.href);
    if (
      destination === null ||
      destination.origin !== browserWindow.location.origin ||
      (destination.href === renderedUrl.href && pendingRender === null)
    ) {
      return;
    }

    cancelScheduledScrollSave();
    if (pendingRender !== null || !hasSameRouteLocation(destination, renderedUrl)) {
      beginNavigation();
      void hardLoad(destination.href, true);
      return;
    }

    beginNavigation();
    // A standalone hashchange is a browser-created same-document entry. It
    // inherits history.state, so give it its own scroll identity; hash changes
    // reached through popstate already updated renderedUrl and returned above.
    currentHistoryEntryId = nextHistoryEntryId++;
    renderedUrl = destination;
    saveCurrentScroll();
  }

  function restoreSameDocumentHistory(destination, restoreScroll, version) {
    if (disposed || version !== navigationVersion) return;
    if (restoreScroll === null) {
      scrollToDestination(destination);
    } else {
      browserWindow.scrollTo(restoreScroll.x, restoreScroll.y);
    }
    saveCurrentScroll();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    beginNavigation();
    cancelScheduledScrollSave();
    for (const timer of scheduledPrefetches.values()) {
      browserWindow.clearTimeout(timer);
    }
    scheduledPrefetches.clear();
    cache.clear();
    scrollByHistoryEntry.clear();
    browserWindow.removeEventListener("popstate", handlePopState);
    browserWindow.removeEventListener("hashchange", handleHashChange);
    browserWindow.removeEventListener("scroll", scheduleScrollSave);
    browserWindow.removeEventListener("pagehide", saveCurrentScroll);
    browserWindow.history.scrollRestoration = previousScrollRestoration;
  }

  function warmTarget(destination) {
    const key = navigationKey(destination);
    const existing = cache.get(key);
    if (
      existing !== undefined &&
      (!existing.settled || existing.expiresAt > Date.now())
    ) {
      return existing.promise;
    }
    if (existing !== undefined) cache.delete(key);

    const record = {
      promise: null,
      settled: false,
      expiresAt: Number.POSITIVE_INFINITY,
    };
    record.promise = fetchTarget(destination).then(
      (target) => {
        record.settled = true;
        record.expiresAt = Date.now() + PREFETCH_MAX_AGE_MS;
        return target;
      },
      (error) => {
        if (cache.get(key) === record) cache.delete(key);
        throw error;
      },
    );
    cache.set(key, record);
    while (cache.size > MAX_CACHE_ENTRIES) {
      cache.delete(cache.keys().next().value);
    }
    return record.promise;
  }

  async function consumeTarget(destination, refresh = false) {
    const key = navigationKey(destination);
    if (refresh) cache.delete(key);
    const promise = warmTarget(destination);
    try {
      return await promise;
    } finally {
      if (cache.get(key)?.promise === promise) cache.delete(key);
    }
  }

  async function fetchTarget(destination) {
    const entry = staticNavigation === null ? null : await staticNavigation.lookup(destination);
    if (entry !== null) {
      const response = await fetchImplementation(new URL(entry.asset, browserWindow.location.origin).href, {
        headers: { accept: "application/json" }, redirect: "error",
      });
      if (!response.ok) {
        throw new Error("[Goribu] Static page data could not be loaded. Reload the page and deploy complete build output.");
      }
      const envelope = await readNavigationEnvelope(response, { buildId: navigationBuildId });
      if (envelope.kind !== "render" || envelope.routeId !== entry.routeId || envelope.status !== 200) {
        throw new Error("[Goribu] Static page data does not match its route. Rebuild and deploy the application together.");
      }
      const Page = await loadClientPage({ routeId: envelope.routeId, pageLoaders });
      return { envelope, Page };
    }
    const endpoint = new URL(NAVIGATION_PATH, browserWindow.location.origin);
    endpoint.searchParams.set("to", navigationKey(destination));
    const response = await fetchImplementation(endpoint.href, {
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    if (navigationBuildId !== null && response.headers.get("x-goribu-build") !== navigationBuildId) {
      throw new Error("[Goribu] The Worker and browser belong to different builds. Reload the page to use matching route code and data.");
    }
    const envelope = await readNavigationEnvelope(response);
    if (envelope.kind !== "render") return { envelope, Page: null };

    const Page = await loadClientPage({
      routeId: envelope.routeId,
      pageLoaders,
    });
    return { envelope, Page };
  }

  function resolveHttpDestination(target, base = undefined) {
    let destination;
    try {
      destination = new URL(target, base ?? browserWindow.location.href);
    } catch {
      return null;
    }
    if (destination.protocol !== "http:" && destination.protocol !== "https:") {
      return null;
    }
    return destination;
  }

  function isSameDocumentHash(destination) {
    const current = new URL(browserWindow.location.href);
    return (
      destination.pathname === current.pathname &&
      destination.search === current.search &&
      destination.href.includes("#")
    );
  }

  function navigationKey(destination) {
    return `${destination.pathname}${destination.search}`;
  }

  function installInitialHistoryState() {
    activateHistoryEntry(browserWindow.history.state);
    saveCurrentScroll();
  }

  function activateHistoryEntry(state) {
    const storedId = readHistoryEntryId(state);
    if (storedId === null) {
      currentHistoryEntryId = nextHistoryEntryId++;
      return;
    }
    currentHistoryEntryId = storedId;
    nextHistoryEntryId = Math.max(nextHistoryEntryId, storedId + 1);
  }

  function scheduleScrollSave() {
    if (disposed) return;
    scrollByHistoryEntry.set(currentHistoryEntryId, currentScrollState());
    if (scrollSaveTimer !== null) return;
    scrollSaveTimer = browserWindow.setTimeout(() => {
      scrollSaveTimer = null;
      saveCurrentScroll();
    }, SCROLL_SAVE_DELAY_MS);
  }

  function saveCurrentScroll() {
    if (disposed) return;
    cancelScheduledScrollSave();
    const scroll = currentScrollState();
    scrollByHistoryEntry.set(currentHistoryEntryId, scroll);
    try {
      browserWindow.history.replaceState(
        mergeHistoryState(
          browserWindow.history.state,
          scroll,
          currentHistoryEntryId,
        ),
        "",
        browserWindow.location.href,
      );
    } catch {
      // Scroll restoration is best-effort and must never block navigation fallback.
    }
  }

  function cancelScheduledScrollSave() {
    if (scrollSaveTimer === null) return;
    browserWindow.clearTimeout(scrollSaveTimer);
    scrollSaveTimer = null;
  }

  function commitHistory(destination, mode) {
    if (mode === "none") return;
    if (mode === "push") currentHistoryEntryId = nextHistoryEntryId++;
    const scroll = { x: 0, y: 0 };
    scrollByHistoryEntry.set(currentHistoryEntryId, scroll);
    const state = mergeHistoryState(
      browserWindow.history.state,
      scroll,
      currentHistoryEntryId,
    );
    if (mode === "replace") {
      browserWindow.history.replaceState(state, "", destination.href);
    } else {
      browserWindow.history.pushState(state, "", destination.href);
    }
  }

  function currentScrollState() {
    return {
      x: Number.isFinite(browserWindow.scrollX) ? browserWindow.scrollX : 0,
      y: Number.isFinite(browserWindow.scrollY) ? browserWindow.scrollY : 0,
    };
  }

  function scrollToDestination(destination) {
    const target = findHashTarget(browserWindow.document, destination.hash);
    if (target !== null && typeof target.scrollIntoView === "function") {
      target.scrollIntoView();
      return;
    }
    browserWindow.scrollTo(0, 0);
  }

  async function hardLoad(target, replace) {
    const destination = new URL(target, browserWindow.location.href);
    const current = new URL(browserWindow.location.href);
    if (
      destination.origin === current.origin &&
      hasSameRouteLocation(destination, current) &&
      destination.href.includes("#")
    ) {
      // Assigning a current-document fragment does not fetch a document. This
      // also handles a bare '#', for which URL.hash is empty. Keep the query.
      destination.hash = "";
      target = destination.href;
    }
    if (replace && typeof browserWindow.location.replace === "function") {
      browserWindow.location.replace(target);
    } else if (typeof browserWindow.location.assign === "function") {
      browserWindow.location.assign(target);
    } else {
      browserWindow.location.href = target;
    }
  }
}

function assertControllerInputs({
  root,
  pageLoaders,
  browserWindow,
  fetchImplementation,
  applyMeta,
}) {
  if (root === null || typeof root !== "object" || typeof root.render !== "function") {
    throw new TypeError(
      "[Goribu] createNavigationController() requires the hydrated React root. Start navigation only after hydrateInitialPage() succeeds.",
    );
  }
  if (
    pageLoaders === null ||
    typeof pageLoaders !== "object" ||
    Array.isArray(pageLoaders)
  ) {
    throw new TypeError(
      "[Goribu] createNavigationController() requires the generated client page loader map.",
    );
  }
  if (
    browserWindow === null ||
    typeof browserWindow !== "object" ||
    browserWindow.location === null ||
    typeof browserWindow.location !== "object" ||
    browserWindow.history === null ||
    typeof browserWindow.history !== "object" ||
    typeof browserWindow.history.pushState !== "function" ||
    typeof browserWindow.history.replaceState !== "function" ||
    typeof browserWindow.addEventListener !== "function" ||
    typeof browserWindow.removeEventListener !== "function" ||
    typeof browserWindow.scrollTo !== "function" ||
    typeof browserWindow.setTimeout !== "function" ||
    typeof browserWindow.clearTimeout !== "function"
  ) {
    throw new TypeError(
      "[Goribu] createNavigationController() requires a browser window with location, history, events, scrolling, and timers.",
    );
  }
  if (typeof fetchImplementation !== "function") {
    throw new TypeError(
      "[Goribu] createNavigationController() requires browser fetch to request the reserved navigation endpoint.",
    );
  }
  if (typeof applyMeta !== "function") {
    throw new TypeError(
      "[Goribu] createNavigationController() requires applyMeta to be a function when provided.",
    );
  }
}

function assertTarget(target) {
  if (typeof target !== "string" || target.length === 0) {
    throw new TypeError(
      "[Goribu] Browser navigation requires a non-empty URL or path string.",
    );
  }
}

function resolveReplace(options) {
  if (options === undefined) return false;
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(
      "[Goribu] Browser navigation options must be an object such as { replace: true }.",
    );
  }
  if (options.replace !== undefined && typeof options.replace !== "boolean") {
    throw new TypeError(
      "[Goribu] Browser navigation options.replace must be a boolean when provided.",
    );
  }
  return options.replace === true;
}

function resolveNavigationSignal(options) {
  const signal = options?.signal;
  if (signal === undefined) return null;
  if (
    signal === null ||
    typeof signal !== "object" ||
    typeof signal.aborted !== "boolean"
  ) {
    throw new TypeError(
      "[Goribu] Internal Form navigation requires an AbortSignal when signal is provided.",
    );
  }
  return signal;
}

function resolveExpectedVersion(options) {
  const version = options?.version;
  if (version === undefined || version === null) return null;
  if (!Number.isInteger(version) || version < 0) {
    throw new TypeError(
      "[Goribu] Internal Form rendering requires a captured non-negative navigation version.",
    );
  }
  return version;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function mergeHistoryState(state, scroll, entryId) {
  const merged =
    state !== null && typeof state === "object" && !Array.isArray(state)
      ? { ...state }
      : {};
  merged[HISTORY_KEY] = Object.freeze({
    id: entryId,
    x: scroll.x,
    y: scroll.y,
  });
  return merged;
}

function readHistoryEntryId(state) {
  const id = state?.[HISTORY_KEY]?.id;
  return Number.isSafeInteger(id) && id >= 0 ? id : null;
}

function readScrollState(state, scrollByHistoryEntry) {
  const entryId = readHistoryEntryId(state);
  const remembered =
    entryId === null ? undefined : scrollByHistoryEntry.get(entryId);
  if (
    remembered !== undefined &&
    Number.isFinite(remembered.x) &&
    Number.isFinite(remembered.y)
  ) {
    return { x: remembered.x, y: remembered.y };
  }

  const value = state?.[HISTORY_KEY];
  if (
    value === null ||
    typeof value !== "object" ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y)
  ) {
    return null;
  }
  return { x: value.x, y: value.y };
}

function hasSameRouteLocation(left, right) {
  return left.pathname === right.pathname && left.search === right.search;
}

function findHashTarget(browserDocument, hash) {
  if (
    hash.length === 0 ||
    browserDocument === null ||
    typeof browserDocument !== "object"
  ) {
    return null;
  }

  const raw = hash.slice(1);
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Keep the raw fragment when percent-decoding is malformed.
  }

  for (const value of decoded === raw ? [raw] : [decoded, raw]) {
    const byId = browserDocument.getElementById?.(value) ?? null;
    if (byId !== null) return byId;
    const byName = browserDocument.getElementsByName?.(value)?.[0] ?? null;
    if (byName !== null) return byName;
  }
  return null;
}

function logNavigationFailure(destination, error) {
  try {
    console.error(
      `[Goribu] Client navigation to ${JSON.stringify(`${destination.pathname}${destination.search}${destination.hash}`)} failed; falling back to a full page load.`,
      error,
    );
  } catch {
    // Logging must never prevent the full-load fallback.
  }
}
