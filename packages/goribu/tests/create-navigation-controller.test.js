/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import { createNavigationController } from "../src/browser/create-navigation-controller.js";

describe("createNavigationController", () => {
  it("uses static assets for prefetch, query navigation, redirects and history, and only scrolls on a repeated static click", async () => {
    const { controller, browser, fetch, root, applyMeta, manifestReady } = staticController();
    await manifestReady();
    await controller.navigate("/start");
    expect(root.render).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1); // Only bootstrap's manifest.
    expect(browser.window.scrollTo).toHaveBeenLastCalledWith(0, 0);

    await controller.prefetch("/about?x=1");
    await controller.navigate("/about?x=1");
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/_goribu/navigation.json", staticAsset,
    ]);
    expect(root.render).toHaveBeenCalledOnce();
    expect(applyMeta).toHaveBeenCalledWith({ title: "Saved title" });
    expect(browser.location.href).toBe("https://example.com/about?x=1");
    const pushes = browser.history.pushState.mock.calls.length;
    await controller.navigate("/about?x=1");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(root.render).toHaveBeenCalledOnce();
    expect(browser.history.pushState).toHaveBeenCalledTimes(pushes);

    await controller.navigate("/redirect");
    expect(browser.location.href).toBe("https://example.com/about#section");
    expect(fetch.mock.calls.filter(([url]) => new URL(url).pathname === "/_goribu/worker-nav")).toHaveLength(1);
    browser.setHref("https://example.com/start");
    browser.dispatch("popstate", { state: { __goribu: { x: 10, y: 80 } } });
    await vi.waitFor(() => expect(browser.window.scrollTo).toHaveBeenLastCalledWith(10, 80));
    expect(fetch.mock.calls.filter(([url]) => new URL(url).pathname === "/_goribu/worker-nav")).toHaveLength(1);
    controller.dispose();
  });

  it("refreshes the current dynamic URL without adding history or reusing completed prefetch data", async () => {
    const { controller, browser, fetch, root } = staticController();
    await controller.prefetch("/dynamic");
    await controller.navigate("/dynamic");
    const pushes = browser.history.pushState.mock.calls.length;
    await controller.navigate("/dynamic");
    expect(fetch.mock.calls.filter(([url]) => new URL(url).pathname === "/_goribu/worker-nav")).toHaveLength(2);
    expect(root.render).toHaveBeenCalledTimes(2);
    expect(browser.history.pushState).toHaveBeenCalledTimes(pushes);
    expect(browser.location.assign).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("cancels pending navigation when the current static page is clicked again", async () => {
    const delayed = deferred();
    const setup = staticController({ dynamicResponse: () => delayed.promise });
    const { controller, browser, root, fetch } = setup;
    const old = controller.navigate("/dynamic");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await controller.navigate("/start");
    delayed.resolve(jsonResponse({ kind: "render", routeId: "page", props: {}, status: 200 }));
    await old;
    expect(root.render).not.toHaveBeenCalled();
    expect(browser.location.href).toBe("https://example.com/start");
    controller.dispose();
  });

  it.each([false, true])("reconciles the URL when returning to the displayed static page during Back (replace: %s)", async (replace) => {
    const delayed = deferred();
    const dynamicResponse = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ kind: "render", routeId: "page", props: { live: true }, status: 200 }))
      .mockImplementationOnce(() => delayed.promise);
    const { controller, browser, root } = staticController({ dynamicResponse });
    try {
      await controller.navigate("/slow");
      const slowState = browser.history.state;
      await controller.navigate("/about");
      browser.history.pushState.mockClear();

      browser.setHref("https://example.com/slow");
      browser.history.state = slowState;
      browser.dispatch("popstate", { state: slowState });
      await vi.waitFor(() => expect(dynamicResponse).toHaveBeenCalledTimes(2));
      await controller.navigate("/about", { replace });

      expect(browser.location.href).toBe("https://example.com/about");
      expect(root.render.mock.lastCall[0].props.children.props.location).toBe(browser.location.href);
      expect(browser.history.pushState).toHaveBeenCalledTimes(replace ? 0 : 1);
      const renders = root.render.mock.calls.length;
      delayed.resolve(jsonResponse({ kind: "render", routeId: "page", props: { stale: true }, status: 200 }));
      await new Promise((done) => setTimeout(done, 0));
      expect(root.render).toHaveBeenCalledTimes(renders);
      expect(browser.location.href).toBe("https://example.com/about");
      expect(browser.location.assign).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });

  it("hard-loads on stale manifests, missing snapshots, wrong route data, or a newer Worker", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const fault of ["manifest", "missing", "route", "worker", "snapshot-build"]) {
        const { controller, browser, root } = staticController({ fault });
        const path = fault === "worker" ? "/dynamic" : "/about";
        await controller.navigate(path);
        expect(browser.location.assign, fault).toHaveBeenCalledWith(`https://example.com${path}`);
        expect(root.render).not.toHaveBeenCalled();
        controller.dispose();
      }
    } finally { log.mockRestore(); }
  });

  it("fetches the reserved endpoint, loads the canonical page, and commits once ready", async () => {
    function PostPage() {}
    const hashTarget = { scrollIntoView: vi.fn() };
    const browser = fakeBrowser("https://example.com/start", {
      appState: { app: "preserved" },
      hashTargets: { comments: hashTarget },
    });
    const root = { render: vi.fn((page) => page.props.children.props.onCommit()) };
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
    expect(applyMeta).toHaveBeenCalledWith({});
    expect(browser.history.pushState).toHaveBeenCalledOnce();
    expect(browser.history.state.app).toBe("preserved");
    expect(browser.location.href).toBe(
      "https://example.com/posts/42?view=full#comments",
    );

    const locatedPage = root.render.mock.calls[0][0].props.children;
    expect(locatedPage.props.location).toBe(
      "https://example.com/posts/42?view=full#comments",
    );
    expect(locatedPage.props.Page).toBe(PostPage);
    expect(locatedPage.props.pageProps).toEqual({ id: "42" });
    expect(hashTarget.scrollIntoView).toHaveBeenCalledOnce();
    const pushes = browser.history.pushState.mock.calls.length;
    await controller.navigate("#comments");
    expect(browser.history.pushState).toHaveBeenCalledTimes(pushes);
    await controller.navigate("#");
    expect(browser.window.scrollTo).toHaveBeenLastCalledWith(0, 0);
    expect(fetch).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("handles explicit redirects and reload directives without intermediate history", async () => {
    function PostPage() {}
    const browser = fakeBrowser("https://example.com/start");
    const root = { render: vi.fn((page) => page.props.children.props.onCommit()) };
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
      root: { render: vi.fn((page) => page.props.children.props.onCommit()) },
      pageLoaders: {},
      browserWindow: browser.window,
      fetch: vi.fn(async () => jsonResponse({ kind: "reload" })),
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
    const root = { render: vi.fn((page) => page.props.children.props.onCommit()) };
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
    const root = { render: vi.fn((page) => page.props.children.props.onCommit()) };
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
    expect(root.render.mock.calls[0][0].props.children.props.Page).toBe(PageB);
    expect(browser.location.href).toBe("https://example.com/b");
    controller.dispose();
  });

  it("invalidates pending routes for hash navigation and keeps hash history same-document", async () => {
    function SlowPage() {}
    const hashTarget = { scrollIntoView: vi.fn() };
    const browser = fakeBrowser("https://example.com/page", {
      hashTargets: { comments: hashTarget },
    });
    const root = { render: vi.fn((page) => page.props.children.props.onCommit()) };
    const pending = deferred();
    const fetch = vi.fn(() => pending.promise);
    const controller = createNavigationController({
      root,
      pageLoaders: {
        "src/routes/slow.jsx": async () => ({ default: SlowPage }),
      },
      browserWindow: browser.window,
      fetch,
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
      root: { render: vi.fn((page) => page.props.children.props.onCommit()) },
      pageLoaders: {},
      browserWindow: browser.window,
      fetch: vi.fn(),
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
    const root = { render: vi.fn((page) => page.props.children.props.onCommit()) };
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
    const root = { render: vi.fn((page) => page.props.children.props.onCommit()) };
    const pending = deferred();
    const fetch = vi.fn(() => pending.promise);
    const controller = createNavigationController({
      root,
      pageLoaders: {
        "src/routes/b.jsx": async () => ({ default: PageB }),
      },
      browserWindow: browser.window,
      fetch,
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
    const root = { render: vi.fn((page) => page.props.children.props.onCommit()) };
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
    const root = { render: vi.fn((page) => page.props.children.props.onCommit()) };
    const loader = vi.fn(async () => ({ default: UpdatedPage }));
    const fetch = vi.fn();
    const controller = createNavigationController({
      root,
      pageLoaders: { "src/routes/todos.jsx": loader },
      browserWindow: browser.window,
      fetch,
    });
    browser.history.pushState.mockClear();
    browser.history.replaceState.mockClear();
    browser.window.scrollTo.mockClear();

    await controller.renderInPlace(
      "src/routes/todos.jsx",
      { todos: ["one"] },
      {},
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
    const locatedPage = root.render.mock.calls[0][0].props.children;
    expect(locatedPage.props.location).toBe(
      "https://example.com/todos?filter=done#list",
    );
    expect(locatedPage.props.Page).toBe(UpdatedPage);
    expect(locatedPage.props.pageProps).toEqual({ todos: ["one"] });
    controller.dispose();
  });

  it("does not let an older Form render overwrite newer client navigation", async () => {
    function UpdatedPage() {}
    const browser = fakeBrowser("https://example.com/todos");
    const root = { render: vi.fn((page) => page.props.children.props.onCommit()) };
    const pageModule = deferred();
    const controller = createNavigationController({
      root,
      pageLoaders: {
        "src/routes/todos.jsx": () => pageModule.promise,
      },
      browserWindow: browser.window,
      fetch: vi.fn(),
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
    const root = { render: vi.fn((page) => page.props.children.props.onCommit()) };
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

  it.each([false, true])("keeps document fallback after a committed Form navigation fails (replace: %s)", async (replace) => {
    const browser = fakeBrowser("https://example.com/current");
    const submission = new AbortController();
    const failure = new Error("destination render failed");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = createNavigationController({
      root: { render(page) {
        // React can unmount the submitting Form before reporting the async
        // destination error. That abort must not suppress document fallback.
        submission.abort();
        queueMicrotask(() => page.props.onError(failure));
      } },
      pageLoaders: { broken: async () => ({ default: function Page() {} }) },
      browserWindow: browser.window,
      fetch: async () => jsonResponse({ kind: "render", routeId: "broken", props: {}, status: 200 }),
    });
    try {
      await controller.navigate("/broken", { replace, signal: submission.signal });
      expect(browser.location[replace ? "replace" : "assign"]).toHaveBeenCalledExactlyOnceWith("https://example.com/broken");
      expect(browser.window.scrollTo).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.stringContaining("full page load"), failure);
    } finally {
      controller.dispose();
      log.mockRestore();
    }
  });

  it("restores saved scroll on popstate and hard-loads malformed protocol responses", async () => {
    function PreviousPage() {}
    const browser = fakeBrowser("https://example.com/current");
    const root = { render: vi.fn((page) => page.props.children.props.onCommit()) };
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

const staticBuildId = "1234567890abcdef1234567890abcdef";
const staticAsset = `/_goribu/navigation/${staticBuildId}/${"a".repeat(64)}.json`;
function staticController({ fault, dynamicResponse } = {}) {
  const browser = fakeBrowser("https://example.com/start");
  const root = { render: vi.fn((page) => page.props.children.props.onCommit()) };
  const applyMeta = vi.fn();
  const fetch = vi.fn(async (url) => {
    const path = new URL(url).pathname;
    if (path === "/_goribu/navigation.json") return jsonResponse({
      buildId: fault === "manifest" ? "old" : staticBuildId,
      routes: Object.fromEntries(["/start", "/about"].map((route) => [route, { routeId: "page", asset: staticAsset }])),
    });
    if (path === staticAsset) {
      if (fault === "missing") return new Response("missing", { status: 404 });
      return jsonResponse({
        kind: "render", routeId: fault === "route" ? "other" : "page", props: { saved: true },
        meta: { title: "Saved title" }, status: 200, buildId: fault === "snapshot-build" ? "old" : staticBuildId,
      });
    }
    const response = dynamicResponse ? await dynamicResponse() : jsonResponse(
      new URL(url).searchParams.get("to") === "/redirect"
        ? { kind: "redirect", location: "/about#section", status: 303 }
        : { kind: "render", routeId: "page", props: { live: true }, status: 200 },
    );
    response.headers.set("x-goribu-build", fault === "worker" ? "new" : staticBuildId);
    return response;
  });
  const controller = createNavigationController({
    root, browserWindow: browser.window, fetch, applyMeta, navigationBuildId: staticBuildId,
    pageLoaders: { page: async () => ({ default: function Page() {} }) },
  });
  return { controller, browser, root, fetch, applyMeta, manifestReady: async () => { await controller.prefetch("/start"); await new Promise((done) => setTimeout(done, 0)); } };
}


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
  const browserDocument = document.implementation.createHTMLDocument();
  browserDocument.getElementById = (id) => hashTargets[id] ?? null;
  browserDocument.getElementsByName = () => [];
  const window = {
    location,
    history,
    document: browserDocument,
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
  const payload =
    body?.kind === "render" && !Object.hasOwn(body, "meta")
      ? { ...body, meta: {} }
      : body;
  return new Response(JSON.stringify(payload), {
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
