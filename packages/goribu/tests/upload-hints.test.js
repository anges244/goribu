/** @vitest-environment jsdom */
import { act, createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { Form, FileUpload } from "../src/index.js";
import { createLocatedPage } from "../src/navigation/location-context.js";
import { hydrateInitialPage } from "../src/browser/hydrate-initial-page.js";
import { createNavigationController } from "../src/browser/create-navigation-controller.js";
import { installNavigationRuntime } from "../src/navigation/navigation-runtime.js";
import { FORM_MEDIA_TYPE } from "../src/forms/form-protocol.js";

let root, runtime, uninstall;
afterEach(async () => {
  if (root) await act(() => root.unmount());
  runtime?.dispose(); uninstall?.();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
});
it("carries safe hints through SSR hydration, navigation and form renders, clearing them on routes without policies", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, "", "/profile");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const uploads = { avatar: { accept: ["image/*"], maxBytes: 5_000_000 } };
  function Page() { return h(Form, { method: "post" }, h(FileUpload, { name: "avatar" }), h("button", null, "Save")); }
  const pageLoaders = { profile: async () => ({ default: Page }) };
  document.body.innerHTML = '<div id="root">' + renderToString(createLocatedPage(Page, {}, window.location.href, undefined, undefined, undefined, { uploads, action: window.location.href })) + '</div>' +
    '<script id="__GORIBU_ROUTE__" type="application/json">' + JSON.stringify({ id: "profile", uploads }) + '</script><script id="__GORIBU_PROPS__" type="application/json">{}</script>';
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => { root = await hydrateInitialPage({ pageLoaders }); });
  expect(document.querySelector('input[type="file"]').accept).toBe("image/*");
  expect(errors).not.toHaveBeenCalled();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ kind: "render", routeId: "profile", props: {}, meta: {}, status: 200,
    uploads: { avatar: { accept: ["application/pdf"], maxBytes: 500 } } }));
  vi.stubGlobal("fetch", fetch);
  runtime = createNavigationController({ root, pageLoaders, fetch, logError: vi.fn() });
  uninstall = installNavigationRuntime(runtime);
  let navigation;
  await act(async () => { navigation = runtime.navigate("/contract"); });
  await navigation;
  expect(document.querySelector('input[type="file"]').accept).toBe("application/pdf");
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ type: "render", route: "profile", props: {}, meta: {},
    uploads: { avatar: { accept: ["text/plain"], maxBytes: 1000 } } }), { headers: { "content-type": FORM_MEDIA_TYPE } }));
  await act(async () => {
    document.querySelector("form").dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  });
  expect(document.querySelector('input[type="file"]').accept).toBe("text/plain");
  fetch.mockResolvedValueOnce(Response.json({ kind: "render", routeId: "profile", props: {}, meta: {}, status: 200 }));
  await act(async () => { navigation = runtime.navigate("/no-policy"); });
  await navigation;
  expect(document.querySelector('input[type="file"]').accept).toBe("");
});
