let activeRuntime = null;

/** Install the browser-owned navigation implementation after initial hydration. */
export function installNavigationRuntime(runtime) {
  if (
    runtime === null ||
    typeof runtime !== "object" ||
    typeof runtime.navigate !== "function" ||
    typeof runtime.renderInPlace !== "function" ||
    typeof runtime.captureVersion !== "function" ||
    typeof runtime.prefetch !== "function" ||
    typeof runtime.schedulePrefetch !== "function" ||
    typeof runtime.cancelPrefetch !== "function" ||
    typeof runtime.saveScroll !== "function"
  ) {
    throw new TypeError(
      "[Goribu] installNavigationRuntime(runtime) requires the complete browser navigation controller. Start it through the goribu/client bootstrap after hydration.",
    );
  }

  if (activeRuntime !== null && activeRuntime !== runtime) {
    activeRuntime.dispose?.();
  }
  activeRuntime = runtime;
  return function uninstallNavigationRuntime() {
    if (activeRuntime === runtime) activeRuntime = null;
  };
}

/** Navigate from application code, falling back to a full browser load before bootstrap. */
export function navigate(target, options = undefined) {
  assertNavigationTarget(target, "navigate(target, options)");
  const replace = resolveReplace(options, "navigate(target, options)");

  if (activeRuntime !== null) {
    return activeRuntime.navigate(target, { replace });
  }

  return loadDocument(target, { replace });
}

/** Internal abort-aware navigation bridge used only by Form. */
export function navigateForm(target, options) {
  assertNavigationTarget(target, "Form navigation");
  const replace = resolveReplace(options, "Form navigation");
  const signal = resolveSignal(options, "Form navigation");
  if (signal.aborted) return Promise.resolve();

  if (activeRuntime !== null) {
    return activeRuntime.navigate(target, { replace, signal });
  }

  return loadDocument(target, { replace });
}

/** Capture the current browser-navigation generation for one Form submission. */
export function captureFormNavigationVersion() {
  return activeRuntime?.captureVersion() ?? null;
}

/** Internal current-document route render bridge used only by Form. */
export function renderFormPage(routeId, props, metadata, options) {
  const signal = resolveSignal(options, "Form render");
  if (signal.aborted) return Promise.resolve();
  if (activeRuntime === null) {
    return Promise.reject(
      new Error(
        "[Goribu] Cannot render a Form response in place because the browser navigation runtime is not installed. Start the page through goribu/client or perform a full document load.",
      ),
    );
  }
  return activeRuntime.renderInPlace(routeId, props, metadata, {
    signal,
    version: options?.version,
  });
}

/** Internal Link prefetch bridge. It intentionally has no public export. */
export function prefetchNavigation(target) {
  if (activeRuntime === null || typeof target !== "string" || target.length === 0) {
    return Promise.resolve();
  }
  return activeRuntime.prefetch(target);
}

/** Internal delayed intent bridge used by Link pointer-enter behavior. */
export function scheduleNavigationPrefetch(target) {
  if (activeRuntime === null || typeof target !== "string" || target.length === 0) {
    return;
  }
  activeRuntime.schedulePrefetch(target);
}

/** Persist the current entry before a Link leaves navigation browser-owned. */
export function saveNavigationScroll() {
  activeRuntime?.saveScroll();
}

/** Cancel a delayed Link intent that has not started yet. */
export function cancelNavigationPrefetch(target) {
  if (activeRuntime === null || typeof target !== "string" || target.length === 0) {
    return;
  }
  activeRuntime.cancelPrefetch(target);
}

/** Perform the fail-closed full-document fallback. */
export function loadDocument(target, options = undefined) {
  const replace = options?.replace === true;
  const browserWindow = globalThis.window;
  if (
    browserWindow === null ||
    typeof browserWindow !== "object" ||
    browserWindow.location === null ||
    typeof browserWindow.location !== "object"
  ) {
    return Promise.reject(
      new Error(
        `[Goribu] Cannot navigate to ${JSON.stringify(target)} because no browser window is available. Call navigate() from browser code after the document has loaded.`,
      ),
    );
  }

  let destination;
  try {
    destination = new URL(target, browserWindow.location.href);
  } catch (cause) {
    return Promise.reject(
      new TypeError(
        `[Goribu] Cannot navigate to ${JSON.stringify(target)} because it is not a valid HTTP(S) URL or path. Pass a same-origin application path or an HTTP(S) document URL.`,
        { cause },
      ),
    );
  }
  if (destination.protocol !== "http:" && destination.protocol !== "https:") {
    return Promise.reject(
      new TypeError(
        `[Goribu] Cannot navigate to ${JSON.stringify(target)} because ${JSON.stringify(destination.protocol)} URLs are not supported. Use a real anchor for non-HTTP destinations.`,
      ),
    );
  }

  try {
    if (replace && typeof browserWindow.location.replace === "function") {
      browserWindow.location.replace(target);
    } else if (typeof browserWindow.location.assign === "function") {
      browserWindow.location.assign(target);
    } else {
      browserWindow.location.href = target;
    }
    return Promise.resolve();
  } catch (cause) {
    return Promise.reject(
      new Error(
        `[Goribu] Could not perform a full browser navigation to ${JSON.stringify(target)}. Pass a valid URL or root-relative application path.`,
        { cause },
      ),
    );
  }
}

function assertNavigationTarget(target, caller) {
  if (typeof target !== "string" || target.length === 0) {
    throw new TypeError(
      `[Goribu] ${caller} requires a non-empty URL or path string. Pass a destination such as "/dashboard".`,
    );
  }
}

function resolveReplace(options, caller) {
  if (options === undefined) return false;
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(
      `[Goribu] ${caller} requires an options object when provided. Pass { replace: true } or omit it.`,
    );
  }
  if (options.replace !== undefined && typeof options.replace !== "boolean") {
    throw new TypeError(
      `[Goribu] ${caller} requires options.replace to be a boolean when provided.`,
    );
  }
  return options.replace === true;
}

function resolveSignal(options, caller) {
  const signal = options?.signal;
  if (
    signal === null ||
    typeof signal !== "object" ||
    typeof signal.aborted !== "boolean"
  ) {
    throw new TypeError(
      `[Goribu] ${caller} requires its internal signal to be an AbortSignal.`,
    );
  }
  return signal;
}
