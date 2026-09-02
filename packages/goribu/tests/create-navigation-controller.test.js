import { describe, expect, it, vi } from "vitest";
import { createNavigationController } from "../src/browser/create-navigation-controller.js";
import { LocationContext } from "../src/navigation/location-context.js";

describe("createNavigationController", () => {
  it("fetches the reserved endpoint, loads the canonical page, and commits once ready", async () => {
    function PostPage() {}
    const hashTarget = { scrollIntoView: vi.fn() };
    const browser = fakeBrowser("https://example.com/start", {
      appState: { app: "preserved" },
      hashTargets: { comments: hashTarget },
    });
    const root = { render: vi.fn() };
    const loader = vi.fn(async () => ({ default: PostPage }));
    const applyMeta = vi.fn();
    const fetch = vi.fn(async () =>
      jsonResponse({
        kind: "render",
        routeId: "src/routes/posts/[id].jsx",
        props: { id: "42" },
        status: 200,
      }),
    );
    const controller = createNavigationController({
      root,
      pageLoaders: { "src/routes/posts/[id].jsx": loader },
      browserWindow: browser.window,
      fetch,
      afterRender: async () => {},
      applyMeta,
    });

    await controller.navigate("/posts/42?view=full#comments");

    expect(fetch).toHaveBeenCalledOnce();
    const [endpoint, init] = fetch.mock.calls[0];
    const endpointUrl = new URL(endpoint);
    expect(endpointUrl.pathname).toBe("/_goribu/worker-nav");
    expect(endpointUrl.searchParams.get("to")).toBe("/posts/42?view=full");
    expect(init).toEqual({
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    expect(init.headers).not.toHaveProperty("X-Goribu");
    expect(loader).toHaveBeenCalledOnce();
    expect(applyMeta).toHaveBeenCalledWith(undefined);
    expect(browser.history.pushState).toHaveBeenCalledOnce();
    expect(browser.history.state.app).toBe("preserved");
    expect(browser.location.href).toBe(
      "https://example.com/posts/42?view=full#comments",
    );

    const locatedPage = root.render.mock.calls[0][0];
    expect(locatedPage.type).toBe(LocationContext.Provider);
    expect(locatedPage.props.value).toBe(
      "https://example.com/posts/42?view=full#comments",
    );
    expect(locatedPage.props.children.type).toBe(PostPage);
    expect(locatedPage.props.children.props).toEqual({ id: "42" });
    expect(hashTarget.scrollIntoView).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("handles explicit redirects and reload directives without intermediate history", async () => {
    function PostPage() {}
    const browser = fakeBrowser("https://example.com/start");
    const root = { render: vi.fn() };
    const fetch = vi.fn(async (endpoint) => {
      const target = new URL(endpoint).searchParams.get("to");
      if (target === "/go") {
        return jsonResponse({ kind: "redirect", location: "/posts/7", status: 303 });
      }
      if (target === "/posts/7") {
        return jsonResponse({
          kind: "render",
          routeId: "src/routes/posts/[id].jsx",
          props: { id: "7" },
          status: 200,
        });
      }
      if (target === "/unsafe") {
        return jsonResponse({
          kind: "redirect",
          location: "javascript:alert(1)",
          status: 303,
        });
      }
      if (target === "/external") {
        return jsonResponse({
          kind: "redirect",
          location: "https://other.example/login",
          status: 303,
        });
      }
      return jsonResponse({ kind: "reload" });
    });
    const controller = createNavigationController({
      root,
      pageLoaders: {
        "src/routes/posts/[id].jsx": async () => ({ default: PostPage }),
      },
      browserWindow: browser.window,
      fetch,
      afterRender: async () => {},
    });

    await controller.navigate("/go");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(browser.history.pushState).toHaveBeenCalledOnce();
    expect(browser.location.href).toBe("https://example.com/posts/7");
    expect(root.render).toHaveBeenCalledOnce();

    await controller.navigate("/api");
    expect(browser.location.assign).toHaveBeenCalledWith("https://example.com/api");

    await controller.navigate("/unsafe");
    expect(browser.location.assign).toHaveBeenCalledWith(
      "https://example.com/unsafe",
    );
    expect(browser.location.assign).not.toHaveBeenCalledWith(
      "javascript:alert(1)",
    );

    await controller.navigate("/external");
    expect(browser.location.assign).toHaveBeenCalledWith(
      "https://other.example/login",
    );
    controller.dispose();
  });

  it("replaces the traversed entry when popstate falls back to a document load", async () => {
    const browser = fakeBrowser("https://example.com/current");
    const controller = createNavigationController({
      root: { render: vi.fn() },
      pageLoaders: {},
      browserWindow: browser.window,
      fetch: vi.fn(async () => jsonResponse({ kind: "reload" })),
      afterRender: async () => {},
    });

    browser.setHref("https://example.com/api");
    browser.dispatch("popstate", { state: null });

    await vi.waitFor(() => {
      expect(browser.location.replace).toHaveBeenCalledWith(
        "https://example.com/api",
      );
    });
    expect(browser.location.assign).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("preserves a fragment through a canonical redirect envelope", async () => {
    function PostPage() {}
    const hashTarget = { scrollIntoView: vi.fn() };
    const browser = fakeBrowser("https://example.com/start", {
      hashTargets: { details: hashTarget },
    });
    const root = { render: vi.fn() };
    const fetch = vi.fn(async (endpoint) => {
      const target = new URL(endpoint).searchParams.get("to");
      if (target === "/posts/8/") {
        return jsonResponse({
          kind: "redirect",
          location: "/posts/8",
          status: 308,
        });
      }
      return jsonResponse({
        kind: "render",
        routeId: "src/routes/posts/[id].jsx",
        props: { id: "8" },
        status: 200,
      });
    });
    const controller = createNavigationController({
      root,
      pageLoaders: {
        "src/routes/posts/[id].jsx": async () => ({ default: PostPage }),
      },
      browserWindow: browser.window,
      fetch,
      afterRender: async () => {},
    });

    await controller.navigate("/posts/8/#details");

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(browser.location.href).toBe("https://example.com/posts/8#details");
    expect(hashTarget.scrollIntoView).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("shares prefetch work with navigation and never commits a stale target", async () => {
    function PageA() {}
    function PageB() {}
    const browser = fakeBrowser("https://example.com/");
    const root = { render: vi.fn() };
    const responses = new Map();
    const fetch = vi.fn((endpoint) => {
      const target = new URL(endpoint).searchParams.get("to");
      const pending = deferred();
      responses.set(target, pending);
      return pending.promise;
    });
    const loaders = {
      "src/routes/a.jsx": vi.fn(async () => ({ default: PageA })),
      "src/routes/b.jsx": vi.fn(async () => ({ default: PageB })),
    };
    const controller = createNavigationController({
      root,
      pageLoaders: loaders,
      browserWindow: browser.window,
      fetch,
      afterRender: async () => {},
    });

    const prefetched = controller.prefetch("/a");
    const navigationA = controller.navigate("/a");
    expect(fetch).toHaveBeenCalledOnce();

    const navigationB = controller.navigate("/b");
    expect(fetch).toHaveBeenCalledTimes(2);
    responses.get("/b").resolve(
      jsonResponse({
        kind: "render",
        routeId: "src/routes/b.jsx",
        props: { page: "b" },
        status: 200,
      }),
    );
    await navigationB;

    responses.get("/a").resolve(
      jsonResponse({
        kind: "render",
        routeId: "src/routes/a.jsx",
        props: { page: "a" },
        status: 200,
      }),
    );
    await Promise.all([prefetched, navigationA]);

    expect(loaders["src/routes/a.jsx"]).toHaveBeenCalledOnce();
    expect(loaders["src/routes/b.jsx"]).toHaveBeenCalledOnce();
    expect(root.render).toHaveBeenCalledOnce();
    expect(root.render.mock.calls[0][0].props.children.type).toBe(PageB);
    expect(browser.location.href).toBe("https://example.com/b");
    controller.dispose();
  });

  it("invalidates pending routes for hash navigation and keeps hash history same-document", async () => {
    function SlowPage() {}
    const hashTarget = { scrollIntoView: vi.fn() };
    const browser = fakeBrowser("https://example.com/page", {
      hashTargets: { comments: hashTarget },
    });
    const root = { render: vi.fn() };
    const pending = deferred();
    const fetch = vi.fn(() => pending.promise);
    const controller = createNavigationController({
      root,
      pageLoaders: {
        "src/routes/slow.jsx": async () => ({ default: SlowPage }),
      },
      browserWindow: browser.window,
      fetch,
      afterRender: async () => {},
    });

    const slowNavigation = controller.navigate("/slow");
    await controller.navigate("#comments");
    pending.resolve(
      jsonResponse({
        kind: "render",
        routeId: "src/routes/slow.jsx",
        props: {},
        status: 200,
      }),
    );
    await slowNavigation;

    expect(root.render).not.toHaveBeenCalled();
    expect(browser.location.href).toBe("https://example.com/page#comments");
    expect(hashTarget.scrollIntoView).toHaveBeenCalledOnce();

    browser.setHref("https://example.com/page#other");
    browser.dispatch("hashchange", {});
    browser.setHref("https://example.com/page#comments");
    browser.dispatch("popstate", { state: { __goribu: { x: 5, y: 9 } } });
    await vi.waitFor(() => {
      expect(browser.window.scrollTo).toHaveBeenCalledWith(5, 9);
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(root.render).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("keeps browser-owned hash entries distinct for scroll restoration", async () => {
    const browser = fakeBrowser("https://example.com/page#one");
    const controller = createNavigationController({
      root: { render: vi.fn() },
      pageLoaders: {},
      browserWindow: browser.window,
      fetch: vi.fn(),
      afterRender: async () => {},
    });

    browser.window.scrollY = 100;
    controller.saveScroll();
    const firstEntryState = browser.history.state;

    browser.setHref("https://example.com/page#two");
    browser.window.scrollY = 200;
    browser.dispatch("hashchange", {});
    browser.dispatch("scroll", {});

    browser.setHref("https://example.com/page#one");
    browser.dispatch("popstate", { state: firstEntryState });
    await vi.waitFor(() => {
      expect(browser.window.scrollTo).toHaveBeenLastCalledWith(0, 100);
    });

    controller.dispose();
  });

  it("retains the latest source scroll when traversal beats the throttled state write", async () => {
    function CurrentPage() {}
    function PreviousPage() {}
    const browser = fakeBrowser("https://example.com/current");
    const root = { render: vi.fn() };
    const fetch = vi.fn(async (endpoint) => {
      const target = new URL(endpoint).searchParams.get("to");
      return jsonResponse({
        kind: "render",
        routeId:
          target === "/previous"
            ? "src/routes/previous.jsx"
            : "src/routes/current.jsx",
        props: {},
        status: 200,
      });
    });
    const controller = createNavigationController({
      root,
      pageLoaders: {
        "src/routes/current.jsx": async () => ({ default: CurrentPage }),
        "src/routes/previous.jsx": async () => ({ default: PreviousPage }),
      },
      browserWindow: browser.window,
      fetch,
      afterRender: async () => {},
    });
    const currentEntryState = browser.history.state;

    browser.window.scrollY = 240;
    browser.dispatch("scroll", {});
    browser.setHref("https://example.com/previous");
    browser.dispatch("popstate", {
      state: { __goribu: { id: 7, x: 3, y: 5 } },
    });
    await vi.waitFor(() => expect(root.render).toHaveBeenCalledTimes(1));

    browser.setHref("https://example.com/current");
    browser.dispatch("popstate", { state: currentEntryState });
    await vi.waitFor(() => expect(root.render).toHaveBeenCalledTimes(2));

    expect(browser.window.scrollTo).toHaveBeenLastCalledWith(0, 240);
    controller.dispose();
  });

  it("keeps the rendered route distinct while a popstate route is still loading", async () => {
    function PageB() {}
    const browser = fakeBrowser("https://example.com/a");
    const root = { render: vi.fn() };
    const pending = deferred();
    const fetch = vi.fn(() => pending.promise);
    const controller = createNavigationController({
      root,
      pageLoaders: {
        "src/routes/b.jsx": async () => ({ default: PageB }),
      },
      browserWindow: browser.window,
      fetch,
      afterRender: async () => {},
    });

    browser.setHref("https://example.com/b");
    browser.dispatch("popstate", { state: null });
    const hashNavigation = controller.navigate("#details");
    pending.resolve(
      jsonResponse({
        kind: "render",
        routeId: "src/routes/b.jsx",
        props: {},
        status: 200,
      }),
    );
    await hashNavigation;

    expect(fetch).toHaveBeenCalledOnce();
    expect(root.render).toHaveBeenCalledOnce();
    expect(browser.location.href).toBe("https://example.com/b#details");
    controller.dispose();
  });

  it("expires completed prefetch data and tolerates failed scroll-state writes", async () => {
    function Page() {}
    const browser = fakeBrowser("https://example.com/");
    const root = { render: vi.fn() };
    const fetch = vi.fn(async () =>
      jsonResponse({
        kind: "render",
        routeId: "src/routes/page.jsx",
        props: {},
        status: 200,
      }),
    );
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const controller = createNavigationController({
      root,
      pageLoaders: {
        "src/routes/page.jsx": async () => ({ default: Page }),
      },
      browserWindow: browser.window,
      fetch,
      afterRender: async () => {},
    });

    try {
      await controller.prefetch("/page");
      expect(fetch).toHaveBeenCalledOnce();
      now.mockReturnValue(11_001);
      browser.history.replaceState.mockImplementation(() => {
        throw new DOMException("too frequent", "SecurityError");
      });

      await controller.navigate("/page");
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(root.render).toHaveBeenCalledOnce();
      expect(browser.location.assign).not.toHaveBeenCalled();
    } finally {
      controller.dispose();
      now.mockRestore();
    }
  });

  it("renders a negotiated Form page in place without changing history or scroll", async () => {
    function UpdatedPage() {}
    const browser = fakeBrowser("https://example.com/todos?filter=done#list");
    browser.window.scrollX = 14;
    browser.window.scrollY = 28;
    const root = { render: vi.fn() };
    const loader = vi.fn(async () => ({ default: UpdatedPage }));
    const fetch = vi.fn();
    const controller = createNavigationController({
      root,
      pageLoaders: { "src/routes/todos.jsx": loader },
      browserWindow: browser.window,
      fetch,
      afterRender: async () => {},
    });
    browser.history.pushState.mockClear();
    browser.history.replaceState.mockClear();
    browser.window.scrollTo.mockClear();

    await controller.renderInPlace(
      "src/routes/todos.jsx",
      { todos: ["one"] },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(loader).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(browser.history.pushState).not.toHaveBeenCalled();
    expect(browser.history.replaceState).not.toHaveBeenCalled();
    expect(browser.window.scrollTo).not.toHaveBeenCalled();
    expect(browser.location.href).toBe(
      "https://example.com/todos?filter=done#list",
    );
    const locatedPage = root.render.mock.calls[0][0];
    expect(locatedPage.type).toBe(LocationContext.Provider);
    expect(locatedPage.props.value).toBe(
      "https://example.com/todos?filter=done#list",
    );
    expect(locatedPage.props.children.type).toBe(UpdatedPage);
    expect(locatedPage.props.children.props).toEqual({ todos: ["one"] });
    controller.dispose();
  });

  it("does not let an older Form render overwrite newer client navigation", async () => {
    function UpdatedPage() {}
    const browser = fakeBrowser("https://example.com/todos");
    const root = { render: vi.fn() };
    const pageModule = deferred();
    const controller = createNavigationController({
      root,
      pageLoaders: {
        "src/routes/todos.jsx": () => pageModule.promise,
      },
      browserWindow: browser.window,
      fetch: vi.fn(),
      afterRender: async () => {},
    });

    const render = controller.renderInPlace(
      "src/routes/todos.jsx",
      { todos: ["stale"] },
      undefined,
      {
        signal: new AbortController().signal,
        version: controller.captureVersion(),
      },
    );
    await controller.navigate("/todos#latest");
    pageModule.resolve({ default: UpdatedPage });

    await expect(render).resolves.toBe(false);
    expect(root.render).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("does not commit Form navigation or in-place rendering after abort", async () => {
    function Page() {}
    const browser = fakeBrowser("https://example.com/current");
    const root = { render: vi.fn() };
    const navigationResponse = deferred();
    const pageModule = deferred();
    const controller = createNavigationController({
      root,
      pageLoaders: {
        "src/routes/next.jsx": async () => ({ default: Page }),
        "src/routes/current.jsx": () => pageModule.promise,
      },
      browserWindow: browser.window,
      fetch: vi.fn(() => navigationResponse.promise),
      afterRender: async () => {},
    });

    const navigationAbort = new AbortController();
    const navigation = controller.navigate("/next", {
      signal: navigationAbort.signal,
    });
    navigationAbort.abort();
    navigationResponse.resolve(
      jsonResponse({
        kind: "render",
        routeId: "src/routes/next.jsx",
        props: {},
        status: 200,
      }),
    );
    await navigation;

    const renderAbort = new AbortController();
    const render = controller.renderInPlace(
      "src/routes/current.jsx",
      {},
      undefined,
      { signal: renderAbort.signal },
    );
    renderAbort.abort();
    pageModule.resolve({ default: Page });
    await render;

    expect(browser.history.pushState).not.toHaveBeenCalled();
    expect(browser.location.assign).not.toHaveBeenCalled();
    expect(root.render).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("restores saved scroll on popstate and hard-loads malformed protocol responses", async () => {
    function PreviousPage() {}
    const browser = fakeBrowser("https://example.com/current");
    const root = { render: vi.fn() };
    const fetch = vi.fn(async (endpoint) => {
      const target = new URL(endpoint).searchParams.get("to");
      if (target === "/previous") {
        return jsonResponse({
          kind: "render",
          routeId: "src/routes/previous.jsx",
          props: {},
          status: 200,
        });
      }
      return new Response("<html>failed</html>", {
        status: 500,
        headers: { "content-type": "text/html" },
      });
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = createNavigationController({
      root,
      pageLoaders: {
        "src/routes/previous.jsx": async () => ({ default: PreviousPage }),
      },
      browserWindow: browser.window,
      fetch,
      afterRender: async () => {},
    });

    try {
      browser.setHref("https://example.com/previous");
      browser.dispatch("popstate", { state: { __goribu: { x: 12, y: 34 } } });
      await vi.waitFor(() => expect(root.render).toHaveBeenCalledOnce());
      expect(browser.window.scrollTo).toHaveBeenCalledWith(12, 34);
      expect(browser.history.pushState).not.toHaveBeenCalled();

      await controller.navigate("/broken");
      expect(browser.location.assign).toHaveBeenCalledWith(
        "https://example.com/broken",
      );
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("falling back to a full page load"),
        expect.any(Error),
      );
    } finally {
      controller.dispose();
      consoleError.mockRestore();
    }
  });
});


function fakeBrowser(initialHref, options = {}) {
  let currentUrl = new URL(initialHref);
  const listeners = new Map();
  const hashTargets = options.hashTargets ?? {};
  const location = {
    get href() {
      return currentUrl.href;
    },
    set href(value) {
      currentUrl = new URL(value, currentUrl);
    },
    get origin() {
      return currentUrl.origin;
    },
    assign: vi.fn((value) => {
      currentUrl = new URL(value, currentUrl);
    }),
    replace: vi.fn((value) => {
      currentUrl = new URL(value, currentUrl);
    }),
  };
  const history = {
    state: options.appState ?? {},
    scrollRestoration: "auto",
    pushState: vi.fn(function (state, title, value) {
      void title;
      this.state = state;
      currentUrl = new URL(value, currentUrl);
    }),
    replaceState: vi.fn(function (state, title, value) {
      void title;
      this.state = state;
      currentUrl = new URL(value, currentUrl);
    }),
  };
  const window = {
    location,
    history,
    document: {
      getElementById(id) {
        return hashTargets[id] ?? null;
      },
      getElementsByName() {
        return [];
      },
    },
    scrollX: 0,
    scrollY: 0,
    scrollTo: vi.fn((x, y) => {
      window.scrollX = x;
      window.scrollY = y;
    }),
    setTimeout,
    clearTimeout,
    addEventListener(type, listener) {
      const values = listeners.get(type) ?? new Set();
      values.add(listener);
      listeners.set(type, values);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };

  return {
    window,
    location,
    history,
    setHref(value) {
      currentUrl = new URL(value, currentUrl);
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
