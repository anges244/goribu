import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { goribu } from "goribu/vite";
import { FORM_MEDIA_TYPE } from "../src/forms/form-protocol.js";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
let root;
let server;
let origin;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "goribu-form-methods-"));
  cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
  for (const name of ["package.json", "goribu.config.js"]) cpSync(join(fixture, name), join(root, name));
  symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
  server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [goribu()],
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = server.resolvedUrls.local[0];
}, 30000);

afterAll(async () => {
  await server?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

it("serves native POST and inactive extended forms through the real Worker", async () => {
  const response = await fetch(new URL("/forms", origin));
  expect(response.status).toBe(200);
  const dom = new JSDOM(await response.text());
  try {
    const document = dom.window.document;
    expect(document.querySelector("#form-post").tagName).toBe("FORM");
    for (const method of ["put", "patch", "delete"]) {
      const wrapper = document.querySelector(`#form-${method}`);
      expect(wrapper.hasAttribute("inert")).toBe(true);
      expect(wrapper.querySelector("input").form).toBeNull();
    }
  } finally {
    dom.window.close();
  }
});

it.each(["POST", "PUT", "PATCH", "DELETE"])("dispatches real %s handlers with every form outcome and ordinary representations", async (method) => {
  const action = new URL("/forms", origin);
  async function submit(fields, { accept = FORM_MEDIA_TYPE, multipart = false, referer = action.href } = {}) {
    const body = multipart ? new FormData() : new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    return fetch(action, { method, body, headers: { accept, referer }, redirect: "manual" });
  }

  for (const multipart of [false, true]) {
    const response = await submit({
      name: "Ada", intent: "save",
      ...(multipart ? { attachment: new File(["hello"], "hello.txt", { type: "text/plain" }) } : {}),
    }, { multipart });
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe(FORM_MEDIA_TYPE);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Origin, Accept");
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("x-form-handler")).toBe(method);
    expect(response.headers.get("set-cookie")).toContain(`last_method=${method}`);
    expect(await response.json()).toEqual({ type: "json", data: {
      method, name: "Ada", intent: "save", attachment: multipart ? "hello.txt" : null,
    } });
  }

  const invalid = await submit({ name: "" });
  expect(invalid.status).toBe(422);
  expect(await invalid.json()).toEqual({ type: "invalid", errors: { name: "Enter a name." } });

  const preview = await submit({ name: "Ada", intent: "preview" });
  expect(await preview.json()).toMatchObject({ type: "render", route: "src/routes/forms.jsx", props: { message: `${method}: Ada` } });
  const unsafePreview = await submit({ name: "Ada", intent: "preview" }, { referer: new URL("/greet", origin).href });
  expect(unsafePreview.status).toBe(500);
  expect(unsafePreview.headers.get("content-type")).not.toBe(FORM_MEDIA_TYPE);
  await unsafePreview.text();

  const redirect = await submit({ name: "Ada", intent: "redirect" });
  expect(redirect.status).toBe(303);
  expect(redirect.headers.get("location")).toBeNull();
  expect(await redirect.json()).toEqual({ type: "redirect", to: `/forms?completed=${method}` });

  const plain = await submit({ name: "Ada", intent: "plain" });
  expect(plain.headers.get("content-type")).toContain("text/plain");
  expect(plain.headers.get("vary")).toBe("Origin, Accept");
  expect(await plain.text()).toBe(`${method}: Ada`);

  const ordinary = await submit({ name: "Ada", intent: "save" }, { accept: `${FORM_MEDIA_TYPE};q=0` });
  expect(ordinary.headers.get("content-type")).toContain("application/json");
  expect(ordinary.headers.get("etag")).toBe('"form-data"');
  expect(ordinary.headers.get("vary")).toBe("Origin, Accept");
  expect(await ordinary.json()).toMatchObject({ method, name: "Ada" });
}, 15000);
