/** @vitest-environment jsdom */

import { act, createElement as h, useId, useLayoutEffect, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNavigationController } from "../src/browser/create-navigation-controller.js";
import { hydrateInitialPage } from "../src/browser/hydrate-initial-page.js";
import { createLocatedPage } from "../src/navigation/location-context.js";

let roots;
let controllers;
let frames;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  roots = [];
  controllers = [];
  frames = [];
  window.history.replaceState({}, "", "/initial");
  window.scrollX = 8;
  window.scrollY = 420;
  vi.spyOn(window, "scrollTo").mockImplementation((x, y) => {
    window.scrollX = x;
    window.scrollY = y;
  });
  // Keep animation frames pending: a correct commit must scroll before any
  // browser frame can paint the destination at the previous page's position.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
});

afterEach(async () => {
  for (const controller of controllers) controller.dispose();
  for (const root of roots) await act(async () => root.unmount());
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["top", "fragment", "history"])("scrolls the committed %s destination before the next animation frame", async (kind) => {
  const { controller } = await mount({ initial: InitialPage, next: NextPage });
  if (kind === "history") {
    let navigation;
    await act(async () => { navigation = controller.navigate("/next"); });
    await drainFrames();
    await navigation;
    window.scrollTo(12, 900);
    controller.saveScroll();
    window.scrollTo.mockClear();

    await act(async () => {
      const traversed = new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
      window.history.back();
      await traversed;
    });
    expect(document.querySelector("main").dataset.page).toBe("initial");
    expect([window.scrollX, window.scrollY]).toEqual([8, 420]);
    expect(window.scrollTo).toHaveBeenLastCalledWith(8, 420);
    return;
  }

  let navigation;
  await act(async () => {
    navigation = controller.navigate(kind === "fragment" ? "/next#section" : "/next");
  });
  expect(document.querySelector("main").dataset.page).toBe("next");
  expect([window.scrollX, window.scrollY]).toEqual(kind === "fragment" ? [0, 260] : [0, 0]);
  expect(window.scrollTo).toHaveBeenLastCalledWith(0, kind === "fragment" ? 260 : 0);
  await navigation;
});

it("preserves hydrated DOM, useId and local state through in-place and same-route commits", async () => {
  function CounterPage({ label = "initial" }) {
    const id = useId();
    const [count, setCount] = useState(0);
    return h("main", null,
      h("label", { htmlFor: id }, label),
      h("input", { id, defaultValue: "draft" }),
      h("button", { onClick: () => setCount((value) => value + 1) }, count),
    );
  }
  const { controller, serverNode, errors } = await mount({ initial: CounterPage });
  const input = document.querySelector("input");
  const id = input.id;
  expect(document.querySelector("main")).toBe(serverNode);
  await act(async () => document.querySelector("button").click());
  input.value = "unsaved edit";

  let rendered;
  await act(async () => {
    rendered = controller.renderInPlace("initial", { label: "saved" }, { title: "Saved" });
  });
  await drainFrames();
  await expect(rendered).resolves.toBe(true);
  expect(document.querySelector("label").textContent).toBe("saved");
  expect(document.querySelector("input")).toBe(input);
  expect(input.id).toBe(id);
  expect(input.value).toBe("unsaved edit");
  expect(document.querySelector("button").textContent).toBe("1");
  expect([window.scrollX, window.scrollY]).toEqual([8, 420]);

  let navigation;
  await act(async () => { navigation = controller.navigate("/initial?refresh=1"); });
  await drainFrames();
  await navigation;
  expect(document.querySelector("main")).toBe(serverNode);
  expect(document.querySelector("input")).toBe(input);
  expect(input.id).toBe(id);
  expect(input.value).toBe("unsaved edit");
  expect(document.querySelector("button").textContent).toBe("1");
  expect(errors).toEqual([]);
});

it("starts the page fresh when navigation changes the path of the same route", async () => {
  function EntryPage({ title = "initial" }) {
    const [draft, setDraft] = useState(title);
    return h("input", { value: draft, onChange: (event) => setDraft(event.target.value) });
  }
  // Both paths match one route, as /e/a and /e/b both match src/routes/e/[id].
  const { controller } = await mount({ initial: EntryPage }, {}, (destination) => ({
    routeId: "initial",
    props: destination.pathname === "/initial" ? {} : { title: destination.pathname.split("/").pop() },
  }));
  const first = document.querySelector("input");

  let navigation;
  await act(async () => { navigation = controller.navigate("/e/b"); });
  await navigation;
  const second = document.querySelector("input");
  expect(second).not.toBe(first);
  expect(second.value).toBe("b");

  await act(async () => {
    const traversed = new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
    window.history.back();
    await traversed;
  });
  await drainFrames();
  expect(window.location.pathname).toBe("/initial");
  expect(document.querySelector("input").value).toBe("initial");
});

it("lets navigation started by a child layout effect own scrolling and settles the superseded commit", async () => {
  let controller;
  let finalNavigation;
  let loadFinal;
  const finalModule = new Promise((resolve) => { loadFinal = resolve; });
  function RedirectingPage() {
    useLayoutEffect(() => {
      finalNavigation = controller.navigate("/final#section");
    }, []);
    return h("main", { "data-page": "redirecting" }, "Redirecting");
  }
  ({ controller } = await mount(
    { initial: InitialPage, next: RedirectingPage },
    { final: () => finalModule },
  ));
  let firstNavigation;
  let firstSettled = false;
  await act(async () => {
    firstNavigation = controller.navigate("/next");
    void firstNavigation.then(() => { firstSettled = true; });
  });
  expect(document.querySelector("main").dataset.page).toBe("redirecting");
  expect(window.scrollTo).not.toHaveBeenCalled();
  expect(firstSettled).toBe(true);

  await act(async () => { loadFinal({ default: NextPage }); });
  expect(document.querySelector("main").dataset.page).toBe("next");
  expect(window.location.pathname).toBe("/final");
  expect([window.scrollX, window.scrollY]).toEqual([0, 260]);
  expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith(0, 260);
  await Promise.all([firstNavigation, finalNavigation]);
});

it("finds a fragment target created by a synchronous layout update before the next frame", async () => {
  function LayoutPage() {
    const [ready, setReady] = useState(false);
    useLayoutEffect(() => { setReady(true); }, []);
    return ready ? h(NextPage) : h("main", { "data-page": "preparing" }, "Preparing");
  }
  const { controller } = await mount({ initial: InitialPage, next: LayoutPage });
  let navigation;
  await act(async () => { navigation = controller.navigate("/next#section"); });
  expect(document.querySelector("main").dataset.page).toBe("next");
  expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith(0, 260);
  await navigation;
});

it("waits for the destination DOM when a hash navigation supersedes a suspended route commit", async () => {
  let release;
  let ready = false;
  const pending = new Promise((resolve) => { release = resolve; });
  function SuspendedPage() {
    if (!ready) throw pending;
    return h(NextPage);
  }
  const { controller } = await mount({ initial: InitialPage, next: SuspendedPage });
  let firstNavigation;
  await act(async () => { firstNavigation = controller.navigate("/next"); });
  expect(document.querySelector("main").dataset.page).toBe("initial");

  let hashNavigation;
  let hashSettled = false;
  await act(async () => {
    hashNavigation = controller.navigate("/next#section");
    void hashNavigation.then(() => { hashSettled = true; });
  });
  expect(window.scrollTo).not.toHaveBeenCalled();
  expect(hashSettled).toBe(false);
  await firstNavigation;

  await act(async () => { ready = true; release(); });
  expect(document.querySelector("main").dataset.page).toBe("next");
  expect(window.location.hash).toBe("#section");
  expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith(0, 260);
  await hashNavigation;
});

it.each(["abort", "dispose"])("settles an in-place render canceled by %s while React has not committed", async (cancellation) => {
  let release;
  let ready = false;
  const pending = new Promise((resolve) => { release = resolve; });
  function PendingPage({ wait = false }) {
    if (wait && !ready) throw pending;
    return h(InitialPage);
  }
  const { controller } = await mount({ initial: PendingPage });
  const abort = new AbortController();
  let rendered;
  let settled = false;
  await act(async () => {
    rendered = controller.renderInPlace("initial", { wait: true }, {}, { signal: abort.signal });
    void rendered.then(() => { settled = true; });
  });
  expect(settled).toBe(false);
  if (cancellation === "abort") abort.abort();
  else controller.dispose();
  await expect(rendered).resolves.toBe(false);

  await act(async () => { ready = true; release(); });
  expect(window.scrollTo).not.toHaveBeenCalled();
});

it("keeps the restored page when Back supersedes a suspended destination", async () => {
  let release;
  let ready = false;
  const pending = new Promise((resolve) => { release = resolve; });
  function SuspendedPage() {
    if (!ready) throw pending;
    return h(NextPage);
  }
  const { controller } = await mount({ initial: InitialPage, next: SuspendedPage });
  let navigation;
  await act(async () => { navigation = controller.navigate("/next"); });
  expect(window.location.pathname).toBe("/next");
  expect(document.querySelector("main").dataset.page).toBe("initial");

  await act(async () => {
    const traversed = new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
    window.history.back();
    await traversed;
  });
  await navigation;
  expect(window.location.pathname).toBe("/initial");
  expect([window.scrollX, window.scrollY]).toEqual([8, 420]);

  await act(async () => { ready = true; release(); });
  expect(document.querySelector("main").dataset.page).toBe("initial");
  expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith(8, 420);
});

it("reports an application render error after navigation has already completed", async () => {
  const failure = new Error("later application error");
  function InteractivePage() {
    const [failed, setFailed] = useState(false);
    if (failed) throw failure;
    return h("button", { onClick: () => setFailed(true) }, "Trigger error");
  }
  const { controller } = await mount({ initial: InitialPage, next: InteractivePage });
  let navigation;
  await act(async () => { navigation = controller.navigate("/next"); });
  await navigation;
  vi.spyOn(console, "error").mockImplementation(() => {});

  let reported;
  try {
    await act(async () => document.querySelector("button").click());
  } catch (error) {
    reported = error;
  }
  // React's uncaught error reaches act. An obsolete navigation callback must
  // not consume it just because this page originally committed via navigation.
  expect(reported).toBe(failure);
});

function InitialPage() {
  return h("main", { "data-page": "initial" }, "Initial");
}

function NextPage() {
  return h("main", { "data-page": "next" }, h("h1", {
    id: "section",
    ref(node) {
      if (node) node.scrollIntoView = () => {
        expect(node.isConnected).toBe(true);
        window.scrollTo(0, 260);
      };
    },
  }, "Destination"));
}

async function mount(pages, additionalLoaders = {}, resolveRoute = (destination) => ({ routeId: destination.pathname.slice(1), props: {} })) {
  const errors = [];
  const container = document.createElement("div");
  container.id = "root";
  container.innerHTML = renderToString(createLocatedPage(pages.initial, {}, window.location.href));
  document.body.appendChild(container);
  const serverNode = container.firstElementChild;
  for (const [id, value] of [["__GORIBU_ROUTE__", { id: "initial" }], ["__GORIBU_PROPS__", {}]]) {
    const script = document.createElement("script");
    script.id = id;
    script.type = "application/json";
    script.textContent = JSON.stringify(value);
    document.body.appendChild(script);
  }
  const pageLoaders = {
    ...Object.fromEntries(Object.entries(pages).map(([id, Page]) => [id, async () => ({ default: Page })])),
    ...additionalLoaders,
  };
  let root;
  await act(async () => {
    root = await hydrateInitialPage({
      pageLoaders,
      hydrate(element, page) {
        return hydrateRoot(element, page, { onRecoverableError: (error) => errors.push(error) });
      },
    });
  });
  roots.push(root);
  const controller = createNavigationController({
    root, pageLoaders, browserWindow: window,
    fetch: async (url) => {
      const destination = new URL(new URL(url).searchParams.get("to"), window.location.origin);
      const { routeId, props } = resolveRoute(destination);
      return Response.json({ kind: "render", routeId, props, meta: { title: routeId }, status: 200 });
    },
  });
  controllers.push(controller);
  return { controller, serverNode, errors };
}

async function drainFrames() {
  // Used only to complete setup and state checks on the old implementation.
  // Scroll timing assertions above deliberately run before draining frames.
  while (frames.length) {
    const current = frames.splice(0);
    await act(async () => { for (const callback of current) callback(0); });
  }
}
