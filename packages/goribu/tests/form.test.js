/** @vitest-environment jsdom */

import { act, createElement as h, createRef } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Form } from "../src/forms/form.js";
import { FORM_FAILURE_MESSAGE, FORM_MEDIA_TYPE } from "../src/forms/form-protocol.js";
import { createNavigationController } from "../src/browser/create-navigation-controller.js";
import { navigate, installNavigationRuntime } from "../src/navigation/navigation-runtime.js";

let mountedRoots;
let uninstallRuntime;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mountedRoots = [];
  window.history.replaceState({}, "", "/current?view=full");
});

afterEach(async () => {
  for (const root of mountedRoots) {
    await act(async () => root.unmount());
  }
  uninstallRuntime?.();
  uninstallRuntime = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("Form", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("uses the submit-time URL, successful controls, and negotiated %s fetch", async (method) => {
    const runtime = installRuntime();
    const onResult = vi.fn();
    const response = formResponse(
      { type: "json", data: { saved: true } },
      { status: 201, url: "https://example.test/current?view=full" },
    );
    const fetch = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetch);
    const ref = createRef();

    const { container } = await mount(
      h(
        Form,
        { method, onResult, ref, className: "editor" },
        h("input", { name: "tag", defaultValue: "one" }),
        h("input", { name: "tag", defaultValue: "two" }),
        h("button", {
          name: "intent",
          value: "remove",
        }, "Remove"),
      ),
    );
    window.history.replaceState({}, "", "/moved?after=render");
    const form = container.querySelector("form");
    const button = container.querySelector("button");

    await submit(form, button);

    expect(ref.current).toBe(form);
    expect(form.className).toBe("editor");
    expect(form.enctype).toBe("multipart/form-data");
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${window.location.origin}/moved?after=render`);
    expect(init.method).toBe(method);
    expect(init.headers).toEqual({ accept: FORM_MEDIA_TYPE });
    expect(init.credentials).toBe("same-origin");
    expect(init.referrer).toBe(`${window.location.origin}/moved?after=render`);
    expect(init.referrerPolicy).toBe("same-origin");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).toBeInstanceOf(URLSearchParams);
    expect(init.body.getAll("tag")).toEqual(["one", "two"]);
    expect(init.body.get("intent")).toBe("remove");
    expect(init).not.toHaveProperty("redirect");
    expect(runtime.navigate).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith({
      ok: true,
      data: { saved: true },
      response,
    });
    await expect(onResult.mock.calls[0][0].response.json()).resolves.toEqual({
      type: "json",
      data: { saved: true },
    });
  });

  it("settles GET through Form navigation, replacing the query and dropping files", async () => {
    const navigation = deferred();
    let navigationVersion = 0;
    const runtime = installRuntime({
      navigate: vi.fn(() => {
        navigationVersion += 1;
        return navigation.promise;
      }),
      captureVersion: vi.fn(() => navigationVersion),
    });
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const states = [];
    const onResult = vi.fn();

    const { container } = await mount(
      h(Form, {
        method: "get",
        action: "/search?old=1#results",
        replace: true,
        onResult,
      }, (state) => {
        states.push({ ...state });
        return h(
          "div",
          null,
          h("input", { name: "q", defaultValue: "goribu" }),
          h("input", { name: "attachment", type: "file" }),
          h("button", null, "Search"),
        );
      }),
    );
    const form = container.querySelector("form");
    expect(form.enctype).toBe("multipart/form-data");

    await act(async () => {
      form.requestSubmit(container.querySelector("button"));
      await Promise.resolve();
    });

    expect(states.at(-1)).toMatchObject({ pending: true });
    expect(runtime.navigate).toHaveBeenCalledWith(
      `${window.location.origin}/search?q=goribu#results`,
      { replace: true, signal: expect.any(AbortSignal) },
    );
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining("file entries were omitted"),
    );

    navigation.resolve();
    await flushReact();

    expect(states.at(-1)).toEqual({ pending: false, errors: null, data: null });
    expect(onResult).toHaveBeenCalledWith({ ok: true });
  });

  it.each(["resolve", "reject"])(
    "abandons a GET completion when newer navigation wins before it can %s",
    async (outcome) => {
      const navigation = deferred();
      let navigationVersion = 0;
      const runtime = installRuntime({
        navigate: vi.fn(() => {
          navigationVersion += 1;
          return navigation.promise;
        }),
        captureVersion: vi.fn(() => navigationVersion),
      });
      const states = [];
      const onResult = vi.fn();

      const { container } = await mount(
        h(Form, { method: "get", action: "/search", onResult }, (state) => {
          states.push({ ...state });
          return h("button", null, "Search");
        }),
      );
      await act(async () => {
        container.querySelector("form").requestSubmit(
          container.querySelector("button"),
        );
        await Promise.resolve();
      });
      expect(states.at(-1)).toMatchObject({ pending: true });
      expect(navigationVersion).toBe(1);

      navigationVersion = 2;
      if (outcome === "resolve") {
        navigation.resolve();
      } else {
        navigation.reject(new Error("superseded navigation failed"));
      }
      await flushReact();

      expect(states.at(-1)).toEqual({
        pending: false,
        errors: null,
        data: null,
      });
      expect(onResult).not.toHaveBeenCalled();
      expect(runtime.navigate).toHaveBeenCalledOnce();
    },
  );

  it("keeps prior data only while pending, then clears it for invalid state and focuses DOM order", async () => {
    installRuntime();
    const secondResponse = deferred();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        formResponse({ type: "json", data: { saved: true } }),
      )
      .mockImplementationOnce(() => secondResponse.promise);
    vi.stubGlobal("fetch", fetch);
    const states = [];
    const results = [];

    const { container } = await mount(
      h(Form, { method: "post", onResult: (result) => results.push(result) }, (state) => {
        states.push({ ...state });
        return h(
          "div",
          null,
          h("input", { name: "first" }),
          h("input", { name: "second" }),
          h("button", null, "Save"),
        );
      }),
    );
    const form = container.querySelector("form");
    const button = container.querySelector("button");
    const first = form.elements.namedItem("first");
    const second = form.elements.namedItem("second");
    first.scrollIntoView = vi.fn();
    second.scrollIntoView = vi.fn();

    await submit(form, button);
    expect(states.at(-1)).toMatchObject({
      pending: false,
      data: { saved: true },
      errors: null,
    });

    await act(async () => {
      form.requestSubmit(button);
      await Promise.resolve();
    });
    expect(states.at(-1)).toMatchObject({
      pending: true,
      data: { saved: true },
      errors: null,
    });

    secondResponse.resolve(
      formResponse({
        type: "invalid",
        errors: { second: "Second error", first: "First error" },
      }),
    );
    await flushReact();

    expect(states.at(-1)).toEqual({
      pending: false,
      data: null,
      errors: { second: "Second error", first: "First error" },
    });
    expect(first.getAttribute("aria-invalid")).toBe("true");
    expect(second.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(first);
    expect(first.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(results.at(-1)).toMatchObject({
      ok: false,
      errors: { second: "Second error", first: "First error" },
    });
  });

  it("marks the first radio and clears only Form-owned invalid attributes", async () => {
    installRuntime();
    const retry = deferred();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          formResponse({
            type: "invalid",
            errors: { other: "Other error", choice: "Choose one" },
          }),
        )
        .mockImplementationOnce(() => retry.promise),
    );

    const { container } = await mount(
      h(
        Form,
        { method: "post" },
        h("input", { name: "choice", type: "radio", value: "one" }),
        h("input", { name: "choice", type: "radio", value: "two" }),
        h("input", { name: "other" }),
        h("button", null, "Save"),
      ),
    );
    const form = container.querySelector("form");
    const button = container.querySelector("button");
    const radios = form.elements.namedItem("choice");
    const firstRadio = radios[0];
    const secondRadio = radios[1];
    const other = form.elements.namedItem("other");
    firstRadio.scrollIntoView = vi.fn();
    other.scrollIntoView = vi.fn();

    await submit(form, button);
    expect(firstRadio.getAttribute("aria-invalid")).toBe("true");
    expect(secondRadio.hasAttribute("aria-invalid")).toBe(false);
    expect(other.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(firstRadio);

    firstRadio.setAttribute("aria-invalid", "false");
    await act(async () => {
      form.requestSubmit(button);
      await Promise.resolve();
    });
    expect(firstRadio.getAttribute("aria-invalid")).toBe("false");
    expect(other.hasAttribute("aria-invalid")).toBe(false);

    retry.resolve(formResponse({ type: "json", data: { saved: true } }));
    await flushReact();
  });

  it("clears completed data for non-2xx JSON while preserving response data only in onResult", async () => {
    installRuntime();
    const states = [];
    const onResult = vi.fn();
    const response = formResponse(
      { type: "json", data: { conflict: true } },
      { status: 409 },
    );
    vi.stubGlobal("fetch", vi.fn(async () => response));

    const { container } = await mount(
      h(Form, { method: "post", onResult }, (state) => {
        states.push({ ...state });
        return h("button", null, "Save");
      }),
    );
    await submit(container.querySelector("form"), container.querySelector("button"));

    expect(states.at(-1)).toEqual({
      pending: false,
      data: null,
      errors: { root: FORM_FAILURE_MESSAGE },
    });
    expect(onResult).toHaveBeenCalledWith({
      ok: false,
      data: { conflict: true },
      errors: { root: FORM_FAILURE_MESSAGE },
      response,
    });
  });

  it("calls onResult before redirect navigation and renders in place before render results", async () => {
    const sequence = [];
    const runtime = installRuntime({
      navigate: vi.fn(async () => sequence.push("navigate")),
      renderInPlace: vi.fn(async () => {
        sequence.push("render");
        return true;
      }),
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(formResponse({ type: "redirect", to: "done" }))
      .mockResolvedValueOnce(
        formResponse({
          type: "render",
          route: "src/routes/current.jsx",
          props: { count: 2 },
          meta: { title: "Count 2" },
        }),
      );
    vi.stubGlobal("fetch", fetch);

    const { container } = await mount(
      h(Form, {
        method: "post",
        action: "/operations/save",
        replace: true,
        onResult() {
          sequence.push("result");
        },
      }, h("button", null, "Save")),
    );
    const form = container.querySelector("form");
    const button = container.querySelector("button");

    await submit(form, button);
    expect(sequence).toEqual(["result", "navigate"]);
    expect(runtime.navigate).toHaveBeenCalledWith(
      `${window.location.origin}/operations/done`,
      {
        replace: true,
        signal: expect.any(AbortSignal),
      },
    );

    await submit(form, button);
    expect(sequence).toEqual(["result", "navigate", "render", "result"]);
    expect(runtime.renderInPlace).toHaveBeenCalledWith(
      "src/routes/current.jsx",
      { count: 2 },
      { title: "Count 2" },
      {
        signal: expect.any(AbortSignal), version: 0,
        recoveryUrl: `${window.location.origin}/operations/save`, replace: true,
      },
    );
  });

  it("resets before successful in-place callbacks but not before invalid or redirect outcomes", async () => {
    installRuntime();
    const callbackValues = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(formResponse({ type: "json", data: { ok: true } }))
      .mockResolvedValueOnce(
        formResponse({ type: "invalid", errors: { title: "Required" } }),
      )
      .mockResolvedValueOnce(
        formResponse({
          type: "render",
          route: "src/routes/current.jsx",
          props: { refreshed: true },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(formResponse({ type: "redirect", to: "/done" }));
    vi.stubGlobal("fetch", fetch);
    let input;

    const { container } = await mount(
      h(Form, {
        method: "post",
        reset: true,
        onResult() {
          callbackValues.push(input.value);
        },
      }, h("input", { name: "title", defaultValue: "initial" }), h("button", null, "Save")),
    );
    const form = container.querySelector("form");
    const button = container.querySelector("button");
    input = form.elements.namedItem("title");
    input.scrollIntoView = vi.fn();

    input.value = "changed";
    await submit(form, button);
    expect(input.value).toBe("initial");
    expect(callbackValues[0]).toBe("initial");

    input.value = "keep me";
    await submit(form, button);
    expect(input.value).toBe("keep me");
    expect(callbackValues[1]).toBe("keep me");

    input.value = "render me";
    await submit(form, button);
    expect(input.value).toBe("initial");
    expect(callbackValues[2]).toBe("initial");

    input.value = "redirect me";
    await submit(form, button);
    expect(input.value).toBe("redirect me");
    expect(callbackValues[3]).toBe("redirect me");
  });

  it("blocks duplicate submits synchronously and reports a network failure once", async () => {
    installRuntime();
    const pending = deferred();
    const fetch = vi.fn(() => pending.promise);
    const states = [];
    const onResult = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const { container } = await mount(
      h(Form, { method: "post", onResult }, (state) => {
        states.push({ ...state });
        return h("button", null, "Save");
      }),
    );
    const form = container.querySelector("form");
    const button = container.querySelector("button");

    await act(async () => {
      form.requestSubmit(button);
      form.requestSubmit(button);
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(states.at(-1)).toMatchObject({ pending: true, errors: null });

    pending.reject(new TypeError("network down"));
    await flushReact();

    expect(states.at(-1)).toEqual({
      pending: false,
      data: null,
      errors: { root: FORM_FAILURE_MESSAGE },
    });
    expect(onResult).toHaveBeenCalledWith({
      ok: false,
      errors: { root: FORM_FAILURE_MESSAGE },
    });
  });

  it.each([false, true])("handles explicit document reload without mutation replay (callback navigates: %s)", async (callbackNavigates) => {
    let navigationVersion = 0;
    const runtime = installRuntime({ captureVersion: () => navigationVersion });
    const origin = window.location.origin;
    const response = formResponse({ type: "reload" });
    const fetch = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetch);
    const onResult = vi.fn(() => {
      if (callbackNavigates) navigationVersion += 1;
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = await mount(
      h(Form, { method: "put", action: "/current?view=updated", reset: true, replace: true, onResult },
        h("input", { name: "title", defaultValue: "initial" }),
        h("button", null, "Save")),
    );
    const form = container.querySelector("form");
    form.elements.namedItem("title").value = "edited";
    const assign = vi.fn();
    const replace = vi.fn();
    vi.stubGlobal("window", {
      location: { href: `${origin}/current?view=full`, assign, replace },
    });

    await submit(form, container.querySelector("button"));

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].method).toBe("PUT");
    if (callbackNavigates) {
      expect(replace).not.toHaveBeenCalled();
    } else {
      expect(replace).toHaveBeenCalledExactlyOnceWith(`${origin}/current?view=updated`);
    }
    expect(assign).not.toHaveBeenCalled();
    expect(runtime.navigate).not.toHaveBeenCalled();
    expect(runtime.renderInPlace).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledExactlyOnceWith({ ok: true, response });
    expect(form.elements.namedItem("title").value).toBe("edited");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each([false, true])("removes fragments from recovery GET targets (replace: %s)", async (replace) => {
    installRuntime();
    const origin = window.location.origin;
    const assign = vi.fn();
    const replaceLocation = vi.fn();
    const fetch = vi.fn(async () => formResponse({ type: "reload" }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", {
      location: { href: `${origin}/current?view=full#form`, assign, replace: replaceLocation },
    });

    for (const action of [undefined, "/current?view=full#other", "/current?view=full#"]) {
      const { container } = await mount(
        h(Form, { method: "post", action, replace }, h("button", null, "Save")),
      );
      await submit(container.querySelector("form"), container.querySelector("button"));
    }

    const load = replace ? replaceLocation : assign;
    expect(load.mock.calls).toEqual(Array(3).fill([`${origin}/current?view=full`]));
    expect(replace ? assign : replaceLocation).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])("lets external onResult navigation own the document (replace: %s)", async (replace) => {
    const browserWindow = {
      location: { href: window.location.href, origin: window.location.origin, assign: vi.fn(), replace: vi.fn() },
      history: window.history,
      document,
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
      setTimeout, clearTimeout,
      scrollTo: vi.fn(),
      scrollX: 0, scrollY: 0,
    };
    const fetch = vi.fn(async () => formResponse({ type: "reload" }));
    vi.stubGlobal("fetch", fetch);
    const controller = createNavigationController({
      root: { render: vi.fn() }, pageLoaders: {}, browserWindow, fetch,
    });
    uninstallRuntime = installNavigationRuntime(controller);
    try {
      const { container } = await mount(
        h(Form, {
          method: "post", replace,
          onResult: () => navigate("https://external.example/done", { replace }),
        }, h("button", null, "Save")),
      );
      vi.stubGlobal("window", browserWindow);
      await submit(container.querySelector("form"), container.querySelector("button"));

      const load = replace ? browserWindow.location.replace : browserWindow.location.assign;
      expect(load).toHaveBeenCalledExactlyOnceWith("https://external.example/done");
      expect(replace ? browserWindow.location.assign : browserWindow.location.replace).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      controller.dispose();
    }
  });

  it("loads an ordinary response document without reporting a protocol error or replaying the mutation", async () => {
    installRuntime();
    const sequence = [];
    const response = new Response("<html>Sign in</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    const origin = window.location.origin;
    Object.defineProperty(response, "url", {
      value: `${origin}/login`,
    });
    const fetch = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetch);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = await mount(
      h(Form, {
        method: "post",
        onResult(result) {
          sequence.push(["result", result]);
        },
      }, h("button", null, "Save")),
    );
    const assign = vi.fn((target) => sequence.push(["load", target]));
    vi.stubGlobal("window", {
      location: {
        href: `${origin}/current?view=full`,
        assign,
        replace: vi.fn(),
      },
    });

    await submit(container.querySelector("form"), container.querySelector("button"));

    expect(fetch).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
    expect(sequence).toEqual([
      [
        "result",
        {
          ok: false,
          errors: { root: FORM_FAILURE_MESSAGE },
          response,
        },
      ],
      ["load", `${origin}/login`],
    ]);
  });

  it("reports a malformed claimed Form envelope before loading its document", async () => {
    installRuntime();
    const origin = window.location.origin;
    const response = formResponse(
      { type: "unknown" },
      { url: `${origin}/repair` },
    );
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onResult = vi.fn();

    const { container } = await mount(
      h(Form, { method: "post", onResult }, h("button", null, "Save")),
    );
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: {
        href: `${origin}/current?view=full`,
        assign,
        replace: vi.fn(),
      },
    });

    await submit(container.querySelector("form"), container.querySelector("button"));

    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(
          /^\[Goribu\] Form submission returned an invalid envelope.*Rebuild the Worker and client together/,
        ),
      }),
    );
    expect(onResult).toHaveBeenCalledWith({
      ok: false,
      errors: { root: FORM_FAILURE_MESSAGE },
      response,
    });
    expect(assign).toHaveBeenCalledWith(`${origin}/repair`);
  });

  it("ignores an in-place result made stale by newer navigation", async () => {
    const states = [];
    const onResult = vi.fn();
    installRuntime({ renderInPlace: vi.fn(async () => false) });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        formResponse({
          type: "render",
          route: "src/routes/current.jsx",
          props: { stale: true },
          meta: {},
        }),
      ),
    );

    const { container } = await mount(
      h(Form, { method: "post", onResult }, (state) => {
        states.push({ ...state });
        return h("button", null, "Save");
      }),
    );
    await submit(container.querySelector("form"), container.querySelector("button"));

    expect(states.at(-1)).toEqual({ pending: false, errors: null, data: null });
    expect(onResult).not.toHaveBeenCalled();
  });

  it("restores prior data when a completion becomes stale before layout effects", async () => {
    let navigationVersion = 0;
    const runtime = installRuntime({
      captureVersion: vi.fn(() => navigationVersion),
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          formResponse({ type: "json", data: { saved: "prior" } }),
        )
        .mockResolvedValueOnce(
          formResponse({ type: "json", data: { saved: "stale" } }),
        ),
    );
    const states = [];
    const onResult = vi.fn();

    const { container } = await mount(
      h(Form, { method: "post", onResult }, (state) => {
        states.push({ ...state });
        if (state.data?.saved === "stale") navigationVersion = 1;
        return h("button", null, "Save");
      }),
    );
    const form = container.querySelector("form");
    const button = container.querySelector("button");

    await submit(form, button);
    expect(states.at(-1)).toEqual({
      pending: false,
      errors: null,
      data: { saved: "prior" },
    });
    onResult.mockClear();

    await submit(form, button);

    expect(states.at(-1)).toEqual({
      pending: false,
      errors: null,
      data: { saved: "prior" },
    });
    expect(onResult).not.toHaveBeenCalled();
    expect(runtime.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid", { type: "invalid", errors: { title: "Required" } }],
    ["json", { type: "json", data: { saved: true } }],
    ["redirect", { type: "redirect", to: "/done" }],
  ])("abandons a stale %s envelope without callbacks or navigation", async (_type, body) => {
    let navigationVersion = 0;
    const runtime = installRuntime({
      captureVersion: vi.fn(() => navigationVersion),
    });
    const envelopeRead = deferred();
    const response = formResponse(body);
    const clone = vi.spyOn(response, "clone").mockReturnValue({
      json: () => envelopeRead.promise,
    });
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const states = [];
    const onResult = vi.fn();

    const { container } = await mount(
      h(Form, { method: "post", onResult }, (state) => {
        states.push({ ...state });
        return h(
          "div",
          null,
          h("input", { name: "title" }),
          h("button", null, "Save"),
        );
      }),
    );
    const form = container.querySelector("form");

    await act(async () => {
      form.requestSubmit(container.querySelector("button"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(clone).toHaveBeenCalledOnce();
    expect(states.at(-1)).toMatchObject({ pending: true });

    navigationVersion = 1;
    envelopeRead.resolve(body);
    await flushReact();

    expect(states.at(-1)).toEqual({ pending: false, errors: null, data: null });
    expect(form.elements.namedItem("title").hasAttribute("aria-invalid")).toBe(false);
    expect(onResult).not.toHaveBeenCalled();
    expect(runtime.navigate).not.toHaveBeenCalled();
  });

  it("aborts on unmount and performs no result callback or navigation", async () => {
    const runtime = installRuntime();
    const pending = deferred();
    const onResult = vi.fn();
    const fetch = vi.fn(() => pending.promise);
    vi.stubGlobal("fetch", fetch);
    const { container, root } = await mount(
      h(Form, { method: "post", onResult }, h("button", null, "Save")),
    );

    await act(async () => {
      container.querySelector("form").requestSubmit();
      await Promise.resolve();
    });
    const signal = fetch.mock.calls[0][1].signal;
    await act(async () => root.unmount());
    mountedRoots.splice(mountedRoots.indexOf(root), 1);
    expect(signal.aborted).toBe(true);

    pending.resolve(formResponse({ type: "redirect", to: "/done" }));
    await flushReact();
    expect(onResult).not.toHaveBeenCalled();
    expect(runtime.navigate).not.toHaveBeenCalled();
  });

  it("prevents native fallback before rethrowing a malformed submitter override", async () => {
    installRuntime();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { container } = await mount(
      h(
        Form,
        { method: "post" },
        h("button", { formMethod: "delete" }, "Delete"),
      ),
    );
    const form = container.querySelector("form");
    const event = submitEvent(container.querySelector("button"));
    let submittedError;
    function captureError(errorEvent) {
      submittedError = errorEvent.error;
      errorEvent.preventDefault();
    }
    window.addEventListener("error", captureError);
    try {
      form.dispatchEvent(event);
    } finally {
      window.removeEventListener("error", captureError);
    }

    expect(event.defaultPrevented).toBe(true);
    expect(submittedError).toMatchObject({
      message: expect.stringContaining(
        '<Form> submitter formmethod must be "get" or "post"',
      ),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves user-cancelled, cross-origin, and targeted submissions native", async () => {
    installRuntime();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const cancelled = await mount(
      h(Form, {
        method: "post",
        onSubmit(event) {
          event.preventDefault();
        },
      }, h("button", null, "Save")),
    );
    const cancelledEvent = submitEvent(cancelled.container.querySelector("button"));
    cancelled.container.querySelector("form").dispatchEvent(cancelledEvent);
    expect(cancelledEvent.defaultPrevented).toBe(true);

    const external = await mount(
      h(Form, { method: "post", action: "https://other.example/save" }, h("button", null, "Save")),
    );
    const externalEvent = submitEvent(external.container.querySelector("button"));
    external.container.querySelector("form").dispatchEvent(externalEvent);
    expect(externalEvent.defaultPrevented).toBe(false);

    const targeted = await mount(
      h(Form, { method: "post", target: "_blank" }, h("button", null, "Save")),
    );
    const targetedEvent = submitEvent(targeted.container.querySelector("button"));
    targeted.container.querySelector("form").dispatchEvent(targetedEvent);
    expect(targetedEvent.defaultPrevented).toBe(false);

    expect(fetch).not.toHaveBeenCalled();
    expect(consoleWarn.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining("cross-origin action"),
      expect.stringContaining("target \"_blank\""),
    ]);
  });

  it.each(["put", "patch", "delete"])("never falls back to a native verb for %s", async (method) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const cases = [
      [{ action: "https://other.example/save" }, {}],
      [{ action: "mailto:test@example.com" }, {}],
      [{ target: "_blank" }, {}],
      [{}, { formAction: "https://other.example/save" }],
      [{}, { formTarget: "_blank" }],
      [{ onSubmit() { throw new Error("Application submit failed"); } }, {}],
    ];
    for (const [props, buttonProps] of cases) {
      const { container } = await mount(
        h(Form, { method, ...props }, h("button", buttonProps, "Save")),
      );
      const event = submitEvent(container.querySelector("button"));
      let submittedError;
      function captureError(errorEvent) {
        submittedError = errorEvent.error;
        errorEvent.preventDefault();
      }
      window.addEventListener("error", captureError);
      try {
        container.querySelector("form").dispatchEvent(event);
      } finally {
        window.removeEventListener("error", captureError);
      }
      expect(event.defaultPrevented).toBe(true);
      expect(submittedError?.message).toContain(props.onSubmit
        ? "Application submit failed"
        : "requires a same-origin HTTP(S) action");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("warns once for ignored encoding, reserved names, and unmatched errors", async () => {
    installRuntime();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        formResponse({
          type: "invalid",
          errors: { missing: "Missing", root: "Form error" },
        }),
      ),
    );

    const { container } = await mount(
      h(
        Form,
        { method: "post", encType: "text/plain" },
        h("input", { name: "root" }),
        h("button", null, "Save"),
      ),
    );
    const form = container.querySelector("form");
    expect(form.enctype).toBe("multipart/form-data");

    await submit(form, container.querySelector("button"));
    await submit(form, container.querySelector("button"));

    expect(consoleWarn.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining("ignored its encType"),
      expect.stringContaining("reserved for form-level errors"),
      expect.stringContaining('error for "missing"'),
    ]);
  });

  it("fails closed when method is missing or unsupported", () => {
    expect(() => renderToString(h(Form, null))).toThrow(
      '<Form> method must be "get", "post", "put", "patch", or "delete"',
    );
    for (const method of ["head", "options", "trace", ""]) {
      expect(() => renderToString(h(Form, { method }))).toThrow(
        'Set the intended method explicitly',
      );
    }
  });
});

describe("Form pre-hydration contract", () => {
  it.each(["put", "PaTcH", "delete"])("enables %s only after hydration, including external submitters", async (method) => {
    installRuntime();
    const fetch = vi.fn(async () => formResponse({ type: "json", data: { saved: true } }));
    vi.stubGlobal("fetch", fetch);
    const ref = createRef();
    const element = h(Form, { method, id: "editor", action: "/current", ref, className: "editor" },
      h("input", { name: "name", defaultValue: "Ada" }),
      h("button", null, "Save"),
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    document.body.append(container);
    const external = document.createElement("button");
    external.setAttribute("form", "editor");
    external.name = "intent";
    external.value = "save";
    document.body.append(external);

    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("[inert].editor")).not.toBeNull();
    expect(container.querySelector("input").form).toBeNull();
    expect(external.form).toBeNull();
    external.click();
    expect(fetch).not.toHaveBeenCalled();
    expect(ref.current).toBeNull();

    const onRecoverableError = vi.fn();
    await act(async () => {
      mountedRoots.push(hydrateRoot(container, element, { onRecoverableError }));
    });
    const form = container.querySelector("form");
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelector("[inert]")).toBeNull();
    expect(ref.current).toBe(form);
    expect(external.form).toBe(form);
    await submit(form, external);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].method).toBe(method.toUpperCase());
    expect(fetch.mock.calls[0][1].body.get("name")).toBe("Ada");
    expect(fetch.mock.calls[0][1].body.get("intent")).toBe("save");
  });

  it("server-renders a natively submittable form with resolved action and method", () => {
    // Before any JavaScript attaches, the real <form> already carries the action
    // and method a native browser submit needs, so a submit that races hydration
    // is an ordinary full-page submission, never a broken no-op.
    const markup = renderToString(
      h(Form, { method: "post", action: "/feedback" }, h("button", null, "Send")),
    );

    expect(markup).toContain("<form");
    expect(markup).toContain('action="/feedback"');
    expect(markup).toContain('method="post"');
    expect(markup).toContain('encType="multipart/form-data"');

    const getMarkup = renderToString(
      h(
        Form,
        { method: "get", action: "/search" },
        h("button", { formMethod: "post" }, "Upload"),
      ),
    );
    expect(getMarkup).toContain('encType="multipart/form-data"');
  });

  it("fails closed instead of rendering in place when no navigation runtime is installed", async () => {
    // No installRuntime(): the navigation controller has not started, the state a
    // submit hits between hydration and bootstrap. An enhanced mutation whose
    // response would render in place cannot — there is no runtime to render it —
    // so it recovers to a non-ok result whose follow-up is a full document load,
    // never a partial in-place commit.
    const onResult = vi.fn();
    const origin = window.location.origin;
    const response = formResponse(
      { type: "render", route: "src/routes/current.jsx", props: { x: 1 } },
      { url: `${origin}/current` },
    );
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const states = [];

    const { container } = await mount(
      h(Form, { method: "post", action: "/current", onResult }, (state) => {
        states.push({ ...state });
        return h("button", null, "Save");
      }),
    );
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: {
        href: `${origin}/current?view=full`,
        assign,
        replace: vi.fn(),
      },
    });
    await submit(
      container.querySelector("form"),
      container.querySelector("button"),
    );

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0][0].ok).toBe(false);
    expect(assign).toHaveBeenCalledWith(`${origin}/current`);
    // The form is still present and settled — nothing was rendered in its place.
    expect(container.querySelector("form")).not.toBeNull();
    expect(states.at(-1)).toMatchObject({ pending: false });
    expect(states.at(-1).errors).not.toBeNull();
  });
});

async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => root.render(element));
  return { container, root };
}

async function submit(form, submitter) {
  await act(async () => {
    form.requestSubmit(submitter);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function flushReact() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function installRuntime(overrides = {}) {
  const runtime = {
    navigate: vi.fn(async () => {}),
    renderInPlace: vi.fn(async () => true),
    captureVersion: vi.fn(() => 0),
    prefetch: vi.fn(async () => {}),
    schedulePrefetch: vi.fn(),
    cancelPrefetch: vi.fn(),
    saveScroll: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  };
  uninstallRuntime = installNavigationRuntime(runtime);
  return runtime;
}

function formResponse(body, options = {}) {
  const payload =
    body?.type === "render" && !Object.hasOwn(body, "meta")
      ? { ...body, meta: {} }
      : body;
  const response = new Response(JSON.stringify(payload), {
    status: options.status ?? 200,
    headers: { "content-type": FORM_MEDIA_TYPE },
  });
  if (options.url !== undefined) {
    Object.defineProperty(response, "url", { value: options.url });
  }
  return response;
}

function submitEvent(submitter) {
  return new SubmitEvent("submit", {
    bubbles: true,
    cancelable: true,
    submitter,
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
