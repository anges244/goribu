/** @vitest-environment jsdom */
import { act, createElement as h, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Form, FileUpload } from "../src/index.js";
import { createLocatedPage } from "../src/navigation/location-context.js";
import { FORM_MEDIA_TYPE } from "../src/forms/form-protocol.js";

let root, container, states, values, fetchMock;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, "", "/profile");
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container); states = []; values = {};
  vi.stubGlobal("fetch", fetchMock = vi.fn());
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((file) => `blob:${file.name}`) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterEach(async () => {
  if (root) await act(() => root.unmount());
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const image = (name = "a.png") => new File(["data"], name, { type: "image/png" });
const target = (ref = "signed-ref") => Response.json({ ref, target: { url: "/_goribu/r2/upload?ref=" + ref, method: "PUT", headers: { "content-type": "image/png" } } });
const saved = () => new Response(JSON.stringify({ type: "json", data: { saved: true } }), { headers: { "content-type": FORM_MEDIA_TYPE } });
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
function fields(names = ["avatar"]) { return names.map((name) => h(FileUpload, { name, key: name }, (state) => { values[name] = state; return h("span", null, state.status); })); }
async function mount({ names, action = "/profile", hints, reset = false } = {}) {
  const Page = () => h(Form, { method: "post", action, reset }, (state) => {
    states.push(state);
    return h(Fragment, null, ...fields(names), h("input", { name: "title", defaultValue: "Profile" }), h("button", { name: "save", value: "yes" }, "Save"));
  });
  await act(() => root.render(createLocatedPage(Page, {}, window.location.href, undefined, undefined, undefined, { uploads: hints, action: window.location.href })));
}
async function pick(index = 0, file = image()) {
  const input = container.querySelectorAll('input[type="file"]')[index];
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
}
async function submit() {
  await act(() => container.querySelector("form").dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: container.querySelector("button") })));
}

it("waits for every upload, exposes independent uploading/pending, and submits refs URL-encoded", async () => {
  const one = deferred(), two = deferred();
  fetchMock.mockResolvedValueOnce(target("one")).mockReturnValueOnce(one.promise)
    .mockResolvedValueOnce(target("two")).mockReturnValueOnce(two.promise).mockResolvedValueOnce(saved());
  await mount({ names: ["avatar", "cover"] });
  await pick(); await pick(1, image("cover.png"));
  expect(states.at(-1)).toMatchObject({ pending: false, uploading: true });
  await submit(); await submit();
  expect(states.at(-1)).toMatchObject({ pending: true, uploading: true });
  expect(fetchMock).toHaveBeenCalledTimes(4);
  await act(() => one.resolve(new Response()));
  expect(fetchMock).toHaveBeenCalledTimes(4);
  await act(() => two.resolve(new Response()));
  const [url, options] = fetchMock.mock.calls[4];
  expect(url).toBe(new URL("/profile", window.location.href).href);
  expect(options.body).toBeInstanceOf(URLSearchParams);
  expect(Object.fromEntries(options.body)).toEqual({ avatar: "one", cover: "two", title: "Profile", save: "yes" });
  expect(container.querySelector('input[type="file"]').name).toBe("");
  expect(container.querySelector('input[name="avatar"]').value).toBe("one");
  expect(states.at(-1)).toMatchObject({ pending: false, uploading: false });
});

it("omits a failed replacement instead of submitting the previous successful ref", async () => {
  const failed = deferred();
  fetchMock.mockResolvedValueOnce(target()).mockResolvedValueOnce(new Response())
    .mockResolvedValueOnce(target("replacement")).mockReturnValueOnce(failed.promise).mockResolvedValueOnce(saved());
  await mount(); await pick(); await pick(0, image("replacement.png")); await submit();
  await act(() => failed.resolve(Response.json({ code: "expired" }, { status: 403 })));
  expect(values.avatar).toMatchObject({ status: "error", errorMessage: "The upload took too long. Try again." });
  expect(fetchMock.mock.calls[4][1].body.has("avatar")).toBe(false);
  expect(container.querySelector('input[name="avatar"]').disabled).toBe(true);
});

it.each(["start", "put"])("unmount aborts during %s, revokes preview and prevents a waiting submit", async (phase) => {
  const wait = deferred();
  if (phase === "put") fetchMock.mockResolvedValueOnce(target());
  fetchMock.mockImplementationOnce((_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    wait.promise.then(resolve);
  }));
  await mount(); await pick(); await submit();
  const signal = fetchMock.mock.lastCall[1].signal;
  await act(() => root.unmount()); root = null;
  expect(signal.aborted).toBe(true);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:a.png");
  await act(() => wait.resolve(phase === "start" ? target() : new Response()));
  expect(fetchMock).toHaveBeenCalledTimes(phase === "start" ? 1 : 2);
});

it("a new pick aborts its predecessor, and a pending submit follows the latest pick", async () => {
  const replacement = deferred();
  fetchMock.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))))
    .mockResolvedValueOnce(target("new")).mockReturnValueOnce(replacement.promise).mockResolvedValueOnce(saved());
  await mount(); await pick(); const firstSignal = fetchMock.mock.calls[0][1].signal; await submit();
  await pick(0, image("new.png"));
  expect(firstSignal.aborted).toBe(true);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:a.png");
  expect(values.avatar.previewUrl).toBe("blob:new.png");
  expect(fetchMock).toHaveBeenCalledTimes(3);
  await act(() => replacement.resolve(new Response()));
  expect(fetchMock.mock.calls[3][1].body.get("avatar")).toBe("new");
});

it("renders a visible default picker, applies current-route hints, and fails type/size locally", async () => {
  const hint = { avatar: { accept: ["image/*"], maxBytes: 3 } };
  const Page = () => h(Form, { method: "post" }, h(FileUpload, { name: "avatar" }));
  await act(() => root.render(createLocatedPage(Page, {}, window.location.href, undefined, undefined, undefined, { uploads: hint, action: window.location.href })));
  expect(container.querySelector('input[type="file"]').hidden).toBe(false);
  expect(container.querySelector('input[type="file"]').accept).toBe("image/*");
  await pick(); expect(container.querySelector('[role="status"]').textContent).toBe("This file is too large. The limit is 0.003 KB.");
  await pick(0, new File(["a"], "a.txt", { type: "text/plain" }));
  expect(container.querySelector('[role="status"]').textContent).toBe("This file type isn't allowed.");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does not use page hints for a different action; supports drops and native picker fallback", async () => {
  fetchMock.mockResolvedValueOnce(target()).mockResolvedValueOnce(new Response());
  await mount({ action: "/save", hints: { avatar: { accept: ["text/plain"], maxBytes: 1 } } });
  const input = container.querySelector('input[type="file"]');
  expect(input.accept).toBe(""); expect(input.hidden).toBe(true);
  const click = vi.spyOn(input, "click").mockImplementation(() => {});
  values.avatar.showPicker(); expect(click).toHaveBeenCalledOnce();
  const preventDefault = vi.fn();
  await act(() => values.avatar.dropProps.onDrop({ preventDefault, dataTransfer: { files: [image()] } }));
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(values.avatar.status).toBe("done");
  expect(fetchMock.mock.calls[0][0]).toBe(new URL("/save", window.location.href).href);
});

it.each(["automatic", "manual"])("%s reset clears the successful ref, hidden input and preview", async (kind) => {
  fetchMock.mockResolvedValueOnce(target()).mockResolvedValueOnce(new Response()).mockResolvedValue(saved());
  await mount({ reset: kind === "automatic" }); await pick();
  const form = container.querySelector("form");
  const hidden = container.querySelector('input[type="hidden"][name="avatar"]');
  expect(values.avatar.status).toBe("done");
  expect(hidden.value).toBe("signed-ref");
  expect(hidden.disabled).toBe(false);
  if (kind === "automatic") await submit();
  else await act(() => form.reset());
  expect(values.avatar).toMatchObject({ file: null, previewUrl: null, status: "idle" });
  expect(hidden.value).toBe("");
  expect(hidden.disabled).toBe(true);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:a.png");
  expect(new FormData(form).has("avatar")).toBe(false);
  await submit();
  expect(fetchMock.mock.lastCall[1].body.has("avatar")).toBe(false);
});

it("shows a cross-route server size limit without learning picker hints", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ code: "size", maxBytes: 5_000_000 }, { status: 400 }));
  await mount({ action: "/save" }); await pick();
  expect(values.avatar.errorMessage).toBe("This file is too large. The limit is 5 MB.");
  expect(container.querySelector('input[type="file"]').accept).toBe("");
});

it("throws a teaching error outside Form, including SSR", () => {
  expect(() => renderToString(h(FileUpload, { name: "avatar" }))).toThrow("[Goribu] <FileUpload> must be inside <Form>. Use upload()");
});

it("preserves successful controls and the submitter when pending disables the form", async () => {
  const transfer = deferred();
  fetchMock.mockResolvedValueOnce(target()).mockReturnValueOnce(transfer.promise).mockResolvedValueOnce(saved());
  await act(() => root.render(h(Form, { method: "post" }, ({ pending }) => h("fieldset", { disabled: pending },
    ...fields(), h("input", { name: "title", defaultValue: "kept" }), h("button", { name: "intent", value: "save", disabled: pending }, "Save")))));
  await pick(); await submit();
  expect(container.querySelector("fieldset").disabled).toBe(true);
  await act(() => transfer.resolve(new Response()));
  expect(Object.fromEntries(fetchMock.mock.calls[2][1].body)).toEqual({ avatar: "signed-ref", title: "kept", intent: "save" });
});
