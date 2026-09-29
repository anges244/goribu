import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../src/runtime/create-app.js";
import { defineConfig } from "../src/runtime/application-config.js";
import { serveR2Upload } from "../src/r2/serve-upload.js";
import { signToken, verifyToken, UPLOAD_PURPOSE, DOWNLOAD_PURPOSE } from "../src/r2/token.js";

const config = { name: "test-media", domain: "media.example.com", private: { name: "test-files" }, jurisdiction: "eu" };
const secret = "test-only-upload-secret";
const uploadId = "178d286e-8f8d-4a92-8b52-d059bf27cf71";
const customMetadata = { "goribu-upload": uploadId };
const file = { name: "photo.PNG", type: "image/png", size: 4 };
const route = { id: "profile", pattern: "/profile/:id", segments: [{ type: "static", value: "profile" }, { type: "dynamic", name: "id" }], hasDefaultExport: false };
const policy = { accept: ["image/*"], maxBytes: 10 };
const payload = () => ({ uploadId, route: route.pattern, field: "avatar", bucket: "default", key: "uploads/photo.png", ...file, putExp: Math.floor(Date.now() / 1000) + 60, exp: Math.floor(Date.now() / 1000) + 3600 });
const token = (changes = {}, purpose = UPLOAD_PURPOSE) => signToken({ ...payload(), ...changes }, secret, purpose);
function bucket() {
  return Object.fromEntries(["head", "get", "put", "delete", "list", "createMultipartUpload", "resumeMultipartUpload"].map((name) => [name, vi.fn()]));
}
function setup({ methods = ["POST"], uploads = { avatar: policy }, middleware, handler, mode = "production", env = {}, r2 = config } = {}) {
  const primary = bucket(), secondary = bucket();
  primary.head.mockResolvedValue({ customMetadata, size: 4, httpMetadata: { contentType: "image/png" } });
  secondary.head.mockResolvedValue({ customMetadata, size: 4, httpMetadata: { contentType: "image/png" } });
  const receive = vi.fn(handler ?? (async (req, res) => {
    const first = req.body();
    expect(req.body()).toBe(first);
    return res.json(await first);
  }));
  const app = createApp({ manifest: [{ ...route, methods }],
    modules: new Map([[route.id, { uploads, ...Object.fromEntries(methods.map((method) => [method, receive])) }], ["middleware", { default: middleware ?? (() => {}) }]]),
    middlewareByRoute: new Map([[route.id, [{ id: "middleware", relativePath: "_middleware.js" }]]]),
    errorPages: { notFound: null }, mode,
    applicationConfig: defineConfig({ name: "test-uploads", compatibilityDate: "2026-09-01", r2 }),
  });
  const bindings = { GORIBU_SECRET: secret, R2: primary, R2_PRIVATE: secondary, ...env };
  const send = (body, headers = {}, method = methods[0], path = "/profile/123") => app.fetch(new Request(`https://app.example.com${path}`, { method, headers, body }), bindings, { waitUntil() {} });
  const start = (data = file, field = "avatar") => send(JSON.stringify(data), { "content-type": "application/json", "x-goribu-upload": field }, "POST");
  return { app, bindings, send, start, primary, secondary, receive };
}
afterEach(() => vi.restoreAllMocks());

it.each(["POST", "PUT", "PATCH"])("starts through middleware for a %s receiver and binds the route pattern", async (method) => {
  let seen;
  const key = vi.fn(({ req, file, ext }) => {
    expect(req).toBe(seen);
    expect(req.userId).toBe("authorized");
    expect(file.name).toBe("photo.PNG");
    expect(ext).toBe(".png");
    return `users/${req.params.id}/photo${ext}`;
  });
  const app = setup({ methods: [method], uploads: { avatar: { ...policy, key } }, middleware(req, res) {
    seen = req; req.userId = "authorized"; res.headers({ "x-middleware": "ran" }); req.cookies.set("visited", "yes");
  } });
  const response = await app.start({ ...file, name: "C:\\fakepath\\photo.PNG\u0000" });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-middleware")).toBe("ran");
  expect(response.headers.get("set-cookie")).toContain("visited=yes");
  const result = await response.json();
  expect(Object.keys(result).sort()).toEqual(["ref", "target"]);
  expect(result.target).toEqual({ url: `/_goribu/r2/upload?ref=${result.ref}`, method: "PUT", headers: { "content-type": "image/png" } });
  const ref = await verifyToken(result.ref, secret, UPLOAD_PURPOSE);
  expect(ref).toMatchObject({ ...file, route: route.pattern, field: "avatar", bucket: "default", key: "users/123/photo.png" });
  expect(ref.exp - ref.putExp).toBe(3540);
  expect(key).toHaveBeenCalledOnce();
  expect(app.receive).not.toHaveBeenCalled();
});

it("preserves middleware refusals and redirects without minting a ref or calling key", async () => {
  for (const status of [401, 403, 303]) {
    const key = vi.fn();
    const app = setup({ uploads: { avatar: { ...policy, key } }, middleware: (req, res) => status === 303 ? res.status(status).redirect("/login") : res.status(status).json({ refused: true }) });
    const response = await app.start();
    expect(response.status).toBe(status);
    if (status === 303) expect(response.headers.get("location")).toBe("/login");
    else expect(await response.json()).toEqual({ refused: true });
    expect(key).not.toHaveBeenCalled();
    expect(app.receive).not.toHaveBeenCalled();
  }
});

it("rejects unknown/prototype fields and invalid metadata before evaluating key", async () => {
  const key = vi.fn();
  const app = setup({ uploads: { avatar: { ...policy, key } } });
  for (const field of ["missing", "__proto__", "constructor", "toString"]) {
    const response = await app.start(file, field);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "field" });
  }
  for (const [change, code] of [[{ type: "text/html" }, "type"], [{ type: "image/*" }, "type"], [{ type: "image/png; charset=utf-8" }, "type"], [{ size: 0 }, "size"], [{ size: 1.1 }, "size"], [{ size: 11 }, "size"], [{ size: "4" }, "size"], [{ name: null }, "name"]]) {
    const response = await app.start({ ...file, ...change });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(code === "size" ? { code, maxBytes: policy.maxBytes } : { code });
  }
  expect((await app.start(null)).status).toBe(400);
  expect(key).not.toHaveBeenCalled();
});

it("normalizes empty MIME types and generates safe default names and keys", async () => {
  const app = setup({ uploads: { avatar: { accept: ["application/octet-stream"], maxBytes: 10 } } });
  for (const name of ["\u0000", "x.VERYLONGEXTENSION", "résumé.PDF"]) {
    const result = await (await app.start({ ...file, name, type: "" })).json();
    const ref = await verifyToken(result.ref, secret, UPLOAD_PURPOSE);
    expect(ref.type).toBe("application/octet-stream");
    expect(ref.key).toMatch(/^uploads\/[a-f0-9-]{36}(\.pdf)?$/);
    expect(ref.name).toBe(name === "\u0000" ? "upload" : name);
  }
});

it("teaches invalid key results and missing production signing configuration", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const key of ["", "/bad", "a/../b", "a/./b", "é".repeat(513), "\ud800", Promise.resolve("async-key")]) {
    const app = setup({ mode: "development", uploads: { avatar: { ...policy, key: () => key } } });
    const response = await app.start();
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("uploads.avatar.key must synchronously return");
  }
  for (const env of [{ GORIBU_SECRET: undefined }, { R2_ACCESS_KEY_ID: "test-key" }, { R2_ACCESS_KEY_ID: "test-key", R2_SECRET_ACCESS_KEY: "test-secret" }]) {
    const app = setup({ env, uploads: { avatar: { ...policy, direct: true } } });
    expect((await app.start()).status).toBe(500);
  }
  expect(log).toHaveBeenCalled();
});

it("signs direct PUT headers, omits browser Content-Length, and always uses Worker URLs in dev", async () => {
  const env = { R2_ACCESS_KEY_ID: "test-key", R2_SECRET_ACCESS_KEY: "test-secret", GORIBU_R2_ACCOUNT_ID: "a".repeat(32) };
  for (const privateBucket of [false, true]) {
    for (const mode of ["production", "development"]) {
      const app = setup({ mode, env: mode === "development" ? {} : env, uploads: { avatar: { ...policy, direct: true, private: privateBucket } } });
      const result = await (await app.start()).json();
      const ref = await verifyToken(result.ref, secret, UPLOAD_PURPOSE);
      expect(ref.uploadId).toMatch(/^[a-f0-9-]{36}$/);
      expect(result.target.method).toBe("PUT");
      expect(result.target.headers).not.toHaveProperty("content-length");
      if (mode === "development") expect(result.target.url).toMatch(/^\/_goribu\/r2\/upload\?ref=/);
      else {
        const url = new URL(result.target.url);
        expect(url.hostname).toBe(`${env.GORIBU_R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`);
        expect(url.pathname).toMatch(privateBucket ? /^\/test-files\/uploads\// : /^\/test-media\/uploads\//);
        expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
        expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(`${privateBucket ? "" : "cache-control;"}content-length;content-type;host;if-none-match;x-amz-meta-goribu-upload`);
        expect(result.target.headers).toEqual({ "content-type": file.type, "if-none-match": "*", "x-amz-meta-goribu-upload": ref.uploadId, ...(!privateBucket ? { "cache-control": "public, max-age=31536000, immutable" } : {}) });
      }
    }
  }
});

async function putRequest(ref, headers = {}, method = "PUT") {
  return new Request(`https://app.example.com/_goribu/r2/upload?ref=${ref}`, { method,
    headers: { "content-type": file.type, "content-length": "4", ...headers }, ...(method === "PUT" ? { body: "data" } : {}) });
}
it("refuses expired/forged refs, wrong purpose, duplicate refs and mismatched headers before touching R2", async () => {
  const r2 = bucket();
  const valid = await token();
  const calls = [
    [await token({ uploadId: undefined }), {}, 403], [await token({ uploadId: "invalid" }), {}, 403],
    [await token({ putExp: 1 }), {}, 403], [await token({ exp: 1 }), {}, 403], [valid + "tamper", {}, 403],
    [await token({}, DOWNLOAD_PURPOSE), {}, 403], [valid + "&ref=" + valid, {}, 403],
    [valid, { "content-length": "3" }, 400], [valid, { "content-type": "text/html" }, 400],
  ];
  for (const [ref, headers, status] of calls) expect((await serveR2Upload(await putRequest(ref, headers), { GORIBU_SECRET: secret }, r2, config, "production")).status).toBe(status);
  expect((await serveR2Upload(await putRequest(valid, {}, "GET"), {}, r2, config, "production")).status).toBe(405);
  expect(r2.put).not.toHaveBeenCalled();
  expect(r2.head).not.toHaveBeenCalled();
  expect(r2.delete).not.toHaveBeenCalled();
});

it("streams production bytes, buffers dev, conditionally writes and deletes only after a failed size check", async () => {
  for (const mode of ["production", "development"]) {
    const r2 = bucket();
    const ref = await token();
    for (const [object, status] of [[{ size: 4 }, 200], [null, 409], [{ size: 5 }, 400]]) {
      r2.put.mockResolvedValue(object);
      const request = await putRequest(ref);
      expect((await serveR2Upload(request, { GORIBU_SECRET: secret }, r2, config, mode)).status).toBe(status);
      const [, body, options] = r2.put.mock.lastCall;
      expect(mode === "development" ? body instanceof ArrayBuffer : body === request.body).toBe(true);
      expect(options).toEqual({ onlyIf: { etagDoesNotMatch: "*" }, customMetadata, httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" } });
      expect(r2.delete).toHaveBeenCalledTimes(status === 400 ? 1 : 0);
    }
    expect(r2.delete).toHaveBeenCalledWith("uploads/photo.png");
    expect(r2.head).not.toHaveBeenCalled();
  }
});

it.each(["json", "urlencoded", "multipart"])("verifies %s refs once for middleware and handler and reconstructs the value", async (encoding) => {
  let readInMiddleware;
  const app = setup({ middleware: async (req) => { readInMiddleware = await req.body(); }, handler: async (req, res) => {
    expect(await req.body()).toBe(readInMiddleware);
    return res.json(await req.body());
  } });
  const ref = await token();
  let body, headers = {};
  if (encoding === "json") { body = JSON.stringify({ avatar: ref, note: "kept" }); headers["content-type"] = "application/json"; }
  if (encoding === "urlencoded") body = new URLSearchParams({ avatar: ref, note: "kept" });
  if (encoding === "multipart") { body = new FormData(); body.set("avatar", ref); body.set("note", "kept"); }
  const response = await app.send(body, headers);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ avatar: { key: "uploads/photo.png", ...file, url: "https://media.example.com/uploads/photo.png" }, note: "kept" });
  expect(app.primary.head).toHaveBeenCalledOnce();
  expect(app.primary.delete).not.toHaveBeenCalled();
});

it("omits forged, expired, wrong-route, wrong-field and wrong-bucket refs without storage side effects", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const app = setup({ mode: "development" });
  const valid = await token();
  for (const avatar of [await token({ uploadId: undefined }), await token({ uploadId: "invalid" }), "forged", valid + "edited", await token({ exp: 1 }), await token({ route: "/different" }), await token({ field: "contract" }), await token({ bucket: "private" }), await token({}, DOWNLOAD_PURPOSE), [valid], { key: "chosen-by-client", size: 4, url: "evil" }]) {
    const response = await app.send(JSON.stringify({ avatar, note: "kept" }), { "content-type": "application/json" });
    expect(await response.json()).toEqual({ note: "kept" });
  }
  const form = new FormData();
  form.set("avatar", new File(["data"], "photo.png", { type: file.type }));
  form.set("other", "kept");
  expect(await (await app.send(form)).json()).toEqual({ other: "kept" });
  expect(app.primary.head).not.toHaveBeenCalled();
  expect(app.secondary.head).not.toHaveBeenCalled();
  expect(app.primary.delete).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalled();
  expect(log.mock.calls.flat().join(" ")).not.toContain(valid);
});

it("omits missing objects, deletes mismatches, preserves R2 failures, and allows repeated valid submissions", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = setup({ uploads: { avatar: { ...policy, private: true } } });
  const body = () => new URLSearchParams({ avatar: ref });
  const ref = await token({ bucket: "private", putExp: 1 }); // Upload window may close before form submission.
  app.secondary.head.mockResolvedValue(null);
  expect(await (await app.send(body())).json()).toEqual({});
  expect(app.secondary.delete).not.toHaveBeenCalled();
  for (const object of [{ size: 5, httpMetadata: { contentType: file.type } }, { size: 4, httpMetadata: { contentType: "text/html" } }]) {
    app.secondary.head.mockResolvedValue({ ...object, customMetadata });
    expect(await (await app.send(body())).json()).toEqual({});
  }
  expect(app.secondary.delete).toHaveBeenCalledTimes(2);
  expect(app.secondary.delete).toHaveBeenLastCalledWith("uploads/photo.png");
  app.secondary.head.mockRejectedValueOnce(new Error("storage unavailable"));
  expect((await app.send(body())).status).toBe(500);
  app.secondary.delete.mockRejectedValueOnce(new Error("cleanup unavailable"));
  expect((await app.send(body())).status).toBe(500);
  app.secondary.head.mockResolvedValue({ customMetadata, size: 4, httpMetadata: { contentType: file.type } });
  for (let i = 0; i < 2; i++) expect(await (await app.send(body())).json()).toEqual({ avatar: { key: "uploads/photo.png", ...file } });
  expect(app.primary.head).not.toHaveBeenCalled();
});

it("never accepts or deletes an existing object after a skipped or conflicting PUT", async () => {
  for (const attemptPut of [false, true]) {
    for (const metadata of [undefined, { "goribu-upload": uploadId }]) {
      for (const size of [file.size, file.size + 1]) {
        const app = setup({ uploads: { avatar: { ...policy, key: () => "avatars/existing.png" } } });
        app.primary.head.mockResolvedValue({ size, httpMetadata: { contentType: file.type }, customMetadata: metadata });
        app.primary.put.mockResolvedValue(null);
        const { ref, target } = await (await app.start()).json();
        const issued = await verifyToken(ref, secret, UPLOAD_PURPOSE);
        expect(issued.uploadId).toMatch(/^[a-f0-9-]{36}$/);
        expect(issued.uploadId).not.toBe(uploadId);
        const second = await (await app.start()).json();
        expect((await verifyToken(second.ref, secret, UPLOAD_PURPOSE)).uploadId).not.toBe(issued.uploadId);
        if (attemptPut) {
          const response = await app.send("data", { ...target.headers, "content-length": "4" }, "PUT", target.url);
          expect(response.status).toBe(409);
        }
        const response = await app.send(new URLSearchParams({ avatar: ref, note: "kept" }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ note: "kept" });
        expect(app.primary.delete).not.toHaveBeenCalled();
        expect(app.primary.put).toHaveBeenCalledTimes(attemptPut ? 1 : 0);
      }
    }
  }
});

it("refuses missing headers and a buffered size mismatch without writing", async () => {
  const r2 = bucket();
  const ref = await token({ size: 5 });
  for (const remove of ["content-length", "content-type", null]) {
    const request = await putRequest(ref, { "content-length": "5" });
    if (remove) request.headers.delete(remove);
    expect((await serveR2Upload(request, { GORIBU_SECRET: secret }, r2, config, "development")).status).toBe(400);
  }
  expect(r2.put).not.toHaveBeenCalled();
  expect(r2.delete).not.toHaveBeenCalled();
});

it("keeps a private-only default bucket private and omits repeated form refs", async () => {
  const app = setup({ r2: { name: "test-files" } });
  const ref = await token();
  expect(await (await app.send(new URLSearchParams({ avatar: ref }))).json()).toEqual({ avatar: { key: "uploads/photo.png", ...file } });
  for (const body of [new FormData(), new URLSearchParams()]) {
    body.append("avatar", ref);
    body.append("avatar", ref);
    expect(await (await app.send(body)).json()).toEqual({});
  }
  expect(app.primary.head).toHaveBeenCalledOnce();
});

it("never dispatches application routes inside the reserved R2 namespace", async () => {
  const handler = vi.fn((req, res) => res.text("user route"));
  for (const path of ["/_goribu/r2", "/_goribu/r2/upload", "/_goribu/r2/claimed", "/_goribu/r2/public/claimed"]) {
    const app = createApp({ manifest: [{ id: "claimed", pattern: path, methods: ["GET", "PUT"], hasDefaultExport: false,
      segments: path.slice(1).split("/").map((value) => ({ type: "static", value })) }],
      modules: new Map([["claimed", { GET: handler, PUT: handler }]]), errorPages: { notFound: null } });
    const response = await app.fetch(new Request(`https://app.example.com${path}`), {}, { waitUntil() {} });
    expect(response.status).toBe(path.endsWith("/upload") ? 405 : 404);
  }
  expect(handler).not.toHaveBeenCalled();
});
