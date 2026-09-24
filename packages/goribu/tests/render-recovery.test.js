/** @vitest-environment jsdom */

import { act, createElement as h, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNavigationController } from "../src/browser/create-navigation-controller.js";
import { Form } from "../src/forms/form.js";
import { FORM_MEDIA_TYPE } from "../src/forms/form-protocol.js";
import { createLocatedPage } from "../src/navigation/location-context.js";
import { installNavigationRuntime } from "../src/navigation/navigation-runtime.js";

let roots;
let controllers;
let uninstall;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  roots = [];
  controllers = [];
  window.history.replaceState({}, "", "/editor?view=old#current");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  uninstall?.();
  uninstall = null;
  for (const controller of controllers) controller.dispose();
  for (const root of roots) await act(async () => root.unmount());
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([false, true])("recovers a failed Form render after its Form unmounts (replace: %s)", async (replace) => {
  const onResult = vi.fn();
  const failure = new Error("The submitted preview cannot render");
  function Editor({ fail = false }) {
    if (fail) throw failure;
    return h(Form, {
      method: "post", action: "/editor?view=saved#target", replace, onResult,
    }, h("button", null, "Save"));
  }
  const { documentLoad, mutation } = await mount(Editor, { props: { fail: true } });

  await submit();

  expect(mutation).toHaveBeenCalledOnce();
  expect(mutation.mock.calls[0][1].method).toBe("POST");
  expect(mutation.mock.calls[0][1].signal.aborted).toBe(true);
  expect(document.querySelector("form")).toBeNull();
  expect(onResult).not.toHaveBeenCalled();
  expect(documentLoad[replace ? "replace" : "assign"]).toHaveBeenCalledExactlyOnceWith(
    `${window.location.origin}/editor?view=saved`,
  );
  expect(documentLoad[replace ? "assign" : "replace"]).not.toHaveBeenCalled();
});

it.each([false, true])("recovers when the response removes its Form before a layout effect fails (replace: %s)", async (replace) => {
  const onResult = vi.fn();
  const failure = new Error("The saved page layout failed");
  const layout = vi.fn(() => { throw failure; });
  function SavedPage() {
    useLayoutEffect(layout, []);
    return h("main", null, "Saved");
  }
  function Editor({ saved = false }) {
    return saved ? h(SavedPage) : h(Form, {
      method: "post", action: "/editor?view=saved#target", replace, onResult,
    }, h("button", null, "Save"));
  }
  const { documentLoad, mutation } = await mount(Editor, { props: { saved: true } });

  await submit();

  expect(layout).toHaveBeenCalledOnce();
  expect(mutation).toHaveBeenCalledOnce();
  expect(mutation.mock.calls[0][1].method).toBe("POST");
  expect(mutation.mock.calls[0][1].signal.aborted).toBe(true);
  expect(document.querySelector("form")).toBeNull();
  expect(onResult).not.toHaveBeenCalled();
  expect(documentLoad[replace ? "replace" : "assign"]).toHaveBeenCalledExactlyOnceWith(
    `${window.location.origin}/editor?view=saved`,
  );
  expect(documentLoad[replace ? "assign" : "replace"]).not.toHaveBeenCalled();
});

it("allows a successful response to remove its Form without recovery or dead callbacks", async () => {
  const onResult = vi.fn();
  function Editor({ saved = false }) {
    return saved ? h("main", null, "Saved") : h(Form, {
      method: "post", action: "/editor?view=saved#target", onResult,
    }, h("button", null, "Save"));
  }
  const { documentLoad, mutation } = await mount(Editor, { props: { saved: true } });

  await submit();

  expect(document.querySelector("main").textContent).toBe("Saved");
  expect(document.querySelector("form")).toBeNull();
  expect(mutation).toHaveBeenCalledOnce();
  expect(mutation.mock.calls[0][1].signal.aborted).toBe(true);
  expect(onResult).not.toHaveBeenCalled();
  expect(documentLoad.assign).not.toHaveBeenCalled();
  expect(documentLoad.replace).not.toHaveBeenCalled();
});

it.each(["navigation", "disposal"])("lets %s win before the replacement page layout fails", async (cancellation) => {
  const onResult = vi.fn();
  const failure = new Error("Obsolete saved page layout failed");
  let controller;
  let navigation;
  function SavedPage() {
    useLayoutEffect(() => {
      if (cancellation === "navigation") navigation = controller.navigate("/next");
      else controller.dispose();
      throw failure;
    }, []);
    return h("main", null, "Saved");
  }
  function Editor({ saved = false }) {
    return saved ? h(SavedPage) : h(Form, {
      method: "post", action: "/editor?view=saved#target", onResult,
    }, h("button", null, "Save"));
  }
  const mounted = await mount(Editor, { props: { saved: true } });
  controller = mounted.controller;

  await submitAllowingCanceledRenderError(failure);
  await act(async () => {});
  await navigation;

  if (cancellation === "navigation") {
    expect(window.location.pathname).toBe("/next");
    expect(document.querySelector("main").textContent).toBe("Next page");
  }
  expect(mounted.mutation).toHaveBeenCalledOnce();
  expect(onResult).not.toHaveBeenCalled();
  expect(mounted.documentLoad.assign).not.toHaveBeenCalled();
  expect(mounted.documentLoad.replace).not.toHaveBeenCalled();
});

it("preserves the Form and local state when the submitted page renders successfully", async () => {
  const onResult = vi.fn();
  function Editor({ saved = false }) {
    const [count, setCount] = useState(0);
    return h("main", null,
      h("p", null, saved ? "Saved" : "Draft"),
      h("button", { type: "button", onClick: () => setCount((value) => value + 1) }, `Count ${count}`),
      h(Form, { method: "post", action: "/editor?view=saved#target", onResult },
        h("input", { name: "draft", defaultValue: "original" }),
        h("button", null, "Save"),
      ),
    );
  }
  const { documentLoad, mutation } = await mount(Editor, { props: { saved: true } });
  const form = document.querySelector("form");
  const input = document.querySelector("input");
  input.value = "unsaved field";
  await act(async () => document.querySelector("button").click());
  await submit();

  expect(document.querySelector("p").textContent).toBe("Saved");
  expect(document.querySelector("button").textContent).toBe("Count 1");
  expect(document.querySelector("form")).toBe(form);
  expect(document.querySelector("input")).toBe(input);
  expect(input.value).toBe("unsaved field");
  expect(mutation).toHaveBeenCalledOnce();
  expect(onResult).toHaveBeenCalledExactlyOnceWith({ ok: true, response: expect.any(Response) });
  expect(documentLoad.assign).not.toHaveBeenCalled();
  expect(documentLoad.replace).not.toHaveBeenCalled();
});

it("settles a direct render failure through the current-document fallback and can render again", async () => {
  function Editor({ fail = false }) {
    if (fail) throw new Error("Direct preview failed");
    return h("main", null, "Editor ready");
  }
  const { controller, documentLoad } = await mount(Editor);
  let rendered;
  await act(async () => { rendered = controller.renderInPlace("editor", { fail: true }, {}); });

  await expect(rendered).resolves.toBe(false);
  expect(documentLoad.replace).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/editor?view=old`);
  expect(documentLoad.assign).not.toHaveBeenCalled();
  expect(document.querySelector("main")).toBeNull();

  await act(async () => { rendered = controller.renderInPlace("editor", { fail: false }, {}); });

  await expect(rendered).resolves.toBe(true);
  expect(document.querySelector("main").textContent).toBe("Editor ready");
  expect(documentLoad.replace).toHaveBeenCalledOnce();
});

it.each(["navigation", "disposal"])("does not recover over %s started while the failed Form unmounts", async (cancellation) => {
  const onResult = vi.fn();
  const failure = new Error("The submitted preview cannot render");
  let cancel;
  let navigation;
  function OwnershipChange() {
    useLayoutEffect(() => () => cancel(), []);
    return null;
  }
  function Editor({ fail = false }) {
    if (fail) throw failure;
    return h("main", null,
      h(OwnershipChange),
      h(Form, { method: "post", action: "/editor?view=saved#target", onResult },
        h("button", null, "Save"),
      ),
    );
  }
  const { controller, documentLoad, mutation } = await mount(Editor, { props: { fail: true } });
  cancel = () => {
    if (cancellation === "disposal") controller.dispose();
    else navigation = controller.navigate("/next");
  };

  await submitAllowingCanceledRenderError(failure);
  await act(async () => {});
  await navigation;

  expect(mutation).toHaveBeenCalledOnce();
  expect(onResult).not.toHaveBeenCalled();
  expect(documentLoad.assign).not.toHaveBeenCalled();
  expect(documentLoad.replace).not.toHaveBeenCalled();
  if (cancellation === "navigation") {
    expect(window.location.pathname).toBe("/next");
    expect(document.querySelector("main").textContent).toBe("Next page");
  }
});

it("retains ordinary Form unmount cancellation while the response page module is loading", async () => {
  let rejectModule;
  const pageModule = new Promise((_resolve, reject) => { rejectModule = reject; });
  const pageLoader = vi.fn(() => pageModule);
  const onResult = vi.fn();
  function Editor() {
    const [showForm, setShowForm] = useState(true);
    return h("main", null,
      h("button", { onClick: () => setShowForm(false) }, "Close editor"),
      showForm ? h(Form, { method: "post", onResult }, h("button", null, "Save")) : "Editor closed",
    );
  }
  const { documentLoad, mutation } = await mount(Editor, { props: {}, pageLoader });
  await submit();
  expect(pageLoader).toHaveBeenCalledOnce();
  await act(async () => document.querySelector("button").click());
  expect(mutation.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { rejectModule(new Error("Page module failed after unmount")); });

  expect(document.querySelector("main").textContent).toContain("Editor closed");
  expect(mutation).toHaveBeenCalledOnce();
  expect(onResult).not.toHaveBeenCalled();
  expect(documentLoad.assign).not.toHaveBeenCalled();
  expect(documentLoad.replace).not.toHaveBeenCalled();
});

it("does not recover a suspended render whose signal was already canceled before it failed", async () => {
  let release;
  let ready = false;
  const suspended = new Promise((resolve) => { release = resolve; });
  const failure = new Error("Canceled preview failed after resuming");
  function Editor({ waiting = false }) {
    if (waiting) {
      if (!ready) throw suspended;
      throw failure;
    }
    return h("main", null, "Original editor");
  }
  const { controller, documentLoad } = await mount(Editor);
  const abort = new AbortController();
  let rendered;
  await act(async () => {
    rendered = controller.renderInPlace("editor", { waiting: true }, {}, { signal: abort.signal });
  });
  expect(document.querySelector("main").textContent).toBe("Original editor");
  abort.abort();
  await expect(rendered).resolves.toBe(false);
  try {
    await act(async () => { ready = true; release(); });
  } catch (error) {
    expect(error).toBe(failure);
  }

  expect(documentLoad.assign).not.toHaveBeenCalled();
  expect(documentLoad.replace).not.toHaveBeenCalled();
});

async function mount(Editor, { props, pageLoader } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(createLocatedPage(Editor, {}, window.location.href)));
  const documentLoad = { assign: vi.fn(), replace: vi.fn() };
  const browserWindow = {
    document,
    history: window.history,
    location: {
      get href() { return window.location.href; },
      get origin() { return window.location.origin; },
      ...documentLoad,
    },
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    scrollTo: window.scrollTo.bind(window),
    console,
  };
  const controller = createNavigationController({
    root, browserWindow,
    pageLoaders: {
      editor: pageLoader ?? (async () => ({ default: Editor })),
      next: async () => ({ default: () => h("main", null, "Next page") }),
    },
    fetch: async (url) => {
      const destination = new URL(new URL(url).searchParams.get("to"), window.location.origin);
      return Response.json({ kind: "render", routeId: destination.pathname.slice(1), props: {}, meta: {}, status: 200 });
    },
  });
  controllers.push(controller);
  uninstall = installNavigationRuntime(controller);
  const mutation = vi.fn(async () => new Response(JSON.stringify({
    type: "render", route: "editor", props, meta: {},
  }), { headers: { "content-type": FORM_MEDIA_TYPE } }));
  vi.stubGlobal("fetch", mutation);
  return { root, controller, documentLoad, mutation };
}

async function submit() {
  await act(async () => {
    const form = document.querySelector("form");
    form.requestSubmit(form.querySelector("button"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function submitAllowingCanceledRenderError(failure) {
  // Cancellation relinquishes recovery ownership. React may report the obsolete
  // render error, but it must not trigger a document load over newer work.
  try {
    await submit();
  } catch (error) {
    expect(error).toBe(failure);
  }
}
