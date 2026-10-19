import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { goribu } from "goribu/vite";
import { FORM_MEDIA_TYPE } from "../src/forms/form-protocol.js";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
let root;
let server;
let origin;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "goribu-cross-origin-"));
  cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
  for (const name of ["package.json", "goribu.config.js"]) cpSync(join(fixture, name), join(root, name));
  symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
  // A callback route that receives posts from an identity provider's page.
  writeFileSync(join(root, "src/routes/callback.js"), [
    "export const allowCrossOriginForms = true;",
    "export async function POST(req, res) {",
    "  return res.json({ state: (await req.body()).state });",
    "}",
  ].join("\n"));
  server = await createServer({
    root,
    cacheDir: join(root, ".vite-cache"),
    configFile: false,
    logLevel: "silent",
    plugins: [goribu()],
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = server.resolvedUrls.local[0].replace(/\/$/, "");
}, 30000);

afterAll(async () => {
  await server?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

function post(path, { headers = {}, body = new URLSearchParams({ name: "Ada", intent: "save" }) } = {}) {
  return fetch(new URL(path, origin), { method: "POST", body, headers, redirect: "manual" });
}

it.each([
  ["a native cross-site form post", { "sec-fetch-site": "cross-site", origin: "https://evil.example" }, undefined],
  ["an enhanced same-site multipart post", { "sec-fetch-site": "same-site", accept: FORM_MEDIA_TYPE }, "multipart"],
  ["a text/plain post from a browser without Sec-Fetch-Site", { origin: "https://evil.example", "content-type": "text/plain" }, "text"],
  ["a post from an opaque origin", { origin: "null" }, undefined],
])("refuses %s before the handler runs", async (_, headers, kind) => {
  const body = kind === "multipart" ? new FormData() : kind === "text" ? "name=Ada" : undefined;
  if (body instanceof FormData) body.append("name", "Ada");
  const response = await post("/forms", { headers, ...(body === undefined ? {} : { body }) });
  expect(response.status).toBe(403);
  expect(response.headers.get("set-cookie")).toBeNull();
  const message = await response.text();
  expect(message).toContain("[Goribu] Refused a cross-origin POST to /forms.");
  expect(message).toContain("export const allowCrossOriginForms = true");
});

it("accepts same-origin posts, non-browser clients and preflighted JSON", async () => {
  const sameOrigin = await post("/forms", {
    headers: { "sec-fetch-site": "same-origin", origin, accept: FORM_MEDIA_TYPE, referer: `${origin}/forms` },
  });
  expect(sameOrigin.status).toBe(201);
  expect(sameOrigin.headers.get("set-cookie")).toContain("last_method=POST");

  // Browsers outside secure contexts omit Sec-Fetch-Site but still send Origin.
  expect((await post("/forms", { headers: { origin } })).status).toBe(201);
  // curl and webhook senders carry neither header.
  expect((await post("/forms")).status).toBe(201);
  // A cross-origin JSON post was preflighted, so the app's CORS answer decided it.
  const json = await post("/forms", {
    headers: { "sec-fetch-site": "cross-site", origin: "https://app.example", "content-type": "application/json" },
    body: JSON.stringify({ name: "Ada", intent: "save" }),
  });
  expect(json.status).toBe(201);
});

it("lets a route that exports allowCrossOriginForms receive cross-site posts", async () => {
  const response = await post("/callback", {
    headers: { "sec-fetch-site": "cross-site", origin: "null" },
    body: new URLSearchParams({ state: "xyz" }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ state: "xyz" });
});
