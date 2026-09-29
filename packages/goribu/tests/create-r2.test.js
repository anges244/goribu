import { describe, expect, it, vi } from "vitest";
import { createApp, defineConfig } from "goribu/server";
import { createR2 } from "../src/runtime/create-r2.js";

const config = { name: "test-media", domain: "media.example.com", private: { name: "test-files" } };
const methods = ["head", "get", "put", "delete", "list", "createMultipartUpload", "resumeMultipartUpload"];
function bucket() {
  return Object.fromEntries(methods.map((method) => [method, vi.fn(function () { return this.result; })]));
}

describe("request R2 facade", () => {
  it("forwards native arguments, receivers and return values, resolving each binding once per request", async () => {
    const binding = bucket();
    const secondary = bucket();
    binding.result = Promise.resolve({ key: "key" });
    secondary.result = { key: "private" };
    const read = vi.fn(() => binding);
    const privateRead = vi.fn(() => secondary);
    const env = { get R2() { return read(); }, get R2_PRIVATE() { return privateRead(); } };
    const r2 = createR2(env, config);
    const other = createR2(env, config);
    const privateBucket = r2.private;
    expect(privateBucket).toBe(r2.private);
    expect(privateBucket.url).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(privateRead).not.toHaveBeenCalled();
    const args = {
      head: ["key"], get: ["key", { range: { offset: 1, length: 2 } }],
      put: ["key", new Uint8Array([0, 255]), { onlyIf: { etagDoesNotMatch: "*" } }],
      delete: [["one", "two"]], list: [{ prefix: "a/", cursor: "next" }],
      createMultipartUpload: ["key", { customMetadata: { source: "test" } }],
      resumeMultipartUpload: ["key", "upload-id"],
    };
    for (const method of methods) {
      const detached = r2[method];
      if (method === "resumeMultipartUpload") binding.result = { uploadId: "upload-id" };
      expect(detached(...args[method])).toBe(binding.result);
      expect(binding[method].mock.calls[0]).toEqual(args[method]);
      expect(binding[method].mock.contexts[0]).toBe(binding);
    }
    expect(read).toHaveBeenCalledOnce();
    expect(privateBucket.get("key")).toBe(secondary.result);
    expect(privateRead).toHaveBeenCalledOnce();
    other.head("key");
    expect(read).toHaveBeenCalledTimes(2);
    const error = new Error("platform failure");
    binding.head.mockImplementation(() => { throw error; });
    await expect(r2.head("key")).rejects.toBe(error);
    expect(binding.head).toHaveBeenCalledTimes(3);
  });

  it("infers File/Blob content type without changing caller options or overriding either metadata form", async () => {
    const binding = bucket();
    const r2 = createR2({ R2: binding }, config);
    for (const value of [new Blob(["csv"], { type: "text/csv" }), new File(["csv"], "a.csv", { type: "text/csv" })]) {
      const options = Object.freeze({ customMetadata: { author: "test" }, httpMetadata: Object.freeze({ cacheControl: "no-store" }) });
      await r2.put("key", value, options);
      expect(binding.put).toHaveBeenLastCalledWith("key", value, { ...options, httpMetadata: { cacheControl: "no-store", contentType: "text/csv" } });
      const headers = new Headers({ "cache-control": "no-store" });
      await r2.put("key", value, { httpMetadata: headers });
      const passed = binding.put.mock.lastCall[2].httpMetadata;
      expect(passed.get("content-type")).toBe("text/csv");
      expect(passed.get("cache-control")).toBe("no-store");
      expect(headers.has("content-type")).toBe(false);
      for (const metadata of [{ contentType: "application/custom" }, { contentType: "" }, new Headers({ "Content-Type": "application/custom" })]) {
        const explicit = { httpMetadata: metadata };
        await r2.put("key", value, explicit);
        expect(binding.put.mock.lastCall[2]).toBe(explicit);
      }
      await r2.put("key", value);
      expect(binding.put.mock.lastCall[2]).toEqual({ httpMetadata: { contentType: "text/csv" } });
    }
    for (const value of [new Blob(["untyped"]), "text", new Uint8Array([1]), new ReadableStream()]) {
      const options = { customMetadata: { author: "test" } };
      await r2.put("key", value, options);
      expect(binding.put.mock.lastCall).toEqual(["key", value, options]);
      expect(binding.put.mock.lastCall[2]).toBe(options);
    }
    const failure = new Error("native rejection");
    binding.put.mockRejectedValue(failure);
    await expect(r2.put("key", "value")).rejects.toBe(failure);
  });

  it("builds encoded public URLs from configuration without touching bindings", () => {
    const env = new Proxy({}, { get() { throw new Error("must not resolve"); } });
    const key = "avatars//é a%?#.png/";
    expect(createR2(env, config).url(key)).toBe("https://media.example.com/avatars//%C3%A9%20a%25%3F%23.png/");
    expect(createR2(env, config, "development").url(key)).toBe("/_goribu/r2/public/avatars//%C3%A9%20a%25%3F%23.png/");
    expect(() => createR2(env, { name: "private" }).url("key")).toThrow(/\[Goribu\].*r2.domain.*signedUrl/);
    for (const key of ["", null, "a/../b", "./b", "\ud800"]) {
      expect(() => createR2(env, config).url(key)).toThrow(/\[Goribu\]/);
    }
  });

  it("rejects async operations on setup errors, keeps synchronous members synchronous, and caches a missing binding", async () => {
    const unconfigured = createR2({});
    const results = await Promise.allSettled(methods.filter((method) => method !== "resumeMultipartUpload").map((method) => unconfigured[method]("key")));
    for (const result of results) {
      expect(result.status).toBe("rejected");
      expect(result.reason.message).toMatch(/\[Goribu\].*no R2 bucket.*goribu.config.js/);
    }
    for (const method of ["resumeMultipartUpload", "url"]) {
      expect(() => unconfigured[method]("key")).toThrow(/\[Goribu\].*no R2 bucket.*goribu.config.js/);
    }
    expect(() => unconfigured.private).toThrow(/no private bucket.*r2.private/);
    expect(() => createR2({}, { name: "test" }).private).toThrow(/no private bucket/);
    const env = {};
    const r2 = createR2(env, config);
    await expect(r2.get("key")).rejects.toThrow(/Expected env.R2.*Pass the Worker env unchanged/);
    env.R2 = bucket();
    await expect(r2.put("key", "value").catch((error) => error.message)).resolves.toContain("Expected env.R2");
    expect(() => createR2(env, config).get("key")).not.toThrow();
    await expect(r2.private.get("key")).rejects.toThrow(/Expected env.R2_PRIVATE/);
    expect(() => r2.private.resumeMultipartUpload("key", "id")).toThrow(/Expected env.R2_PRIVATE/);
    await expect(createR2({ R2: {} }, config).get("key")).rejects.toThrow(/not a Workers R2 bucket/);
  });
});

const route = { id: "r2", pattern: "/r2", segments: [{ type: "static", value: "r2" }], methods: ["GET"], hasDefaultExport: false };
function app(GET, { middleware = [], mode = "development", r2 = config } = {}) {
  return createApp({
    mode, manifest: [route], errorPages: { notFound: null, serverError: null },
    applicationConfig: defineConfig({ name: "test-app", compatibilityDate: "2026-09-01", ...(r2 ? { r2 } : {}) }),
    middlewareByRoute: new Map([[route.id, middleware.length ? [{ id: "middleware", relativePath: "_middleware.js" }] : []]]),
    modules: new Map([[route.id, { GET }], ["middleware", { default: middleware }]]),
  });
}
const ctx = { waitUntil() {} };
const request = (path = "/r2", options) => new Request(`https://goribu.test${path}`, options);

describe("R2 through the Worker request boundary", () => {
  it("shares middleware and handler state within a fetch, isolates requests, and flushes cookies", async () => {
    const facades = [];
    const application = app(async (req, res) => {
      expect(req.r2).toBe(facades.at(-1));
      await req.r2.head("key");
      return res.text(req.r2.url("key"));
    }, { middleware: [(req) => { facades.push(req.r2); req.cookies.set("visited", "yes"); }] });
    const read = vi.fn(() => bucket());
    for (let i = 0; i < 2; i++) {
      const response = await application.fetch(request(), { get R2() { return read(); } }, ctx);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("/_goribu/r2/public/key");
      expect(response.headers.get("set-cookie")).toContain("visited=yes");
    }
    expect(facades[0]).not.toBe(facades[1]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("leaves unused bindings untouched and routes missing bindings through the error boundary", async () => {
    const read = vi.fn(() => { throw new Error("unused"); });
    const plain = app((_req, res) => res.text("no R2"), { r2: null });
    const response = await plain.fetch(request(), { get R2() { return read(); } }, ctx);
    expect(response.status).toBe(200);
    expect(read).not.toHaveBeenCalled();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failing = app(async (req, res) => res.json(await req.r2.get("key")));
      const response = await failing.fetch(request(), {}, ctx);
      expect(response.status).toBe(500);
      expect(await response.text()).toContain("Expected env.R2");
      for (const path of ["/_goribu/r2/public/key", "/_goribu/r2/file?t=test"]) {
        const failure = await failing.fetch(request(path), {}, ctx);
        expect(failure.status).toBe(500);
        expect(failure.headers.get("content-security-policy")).toBe("sandbox");
        expect(failure.headers.get("x-content-type-options")).toBe("nosniff");
      }
    } finally { log.mockRestore(); }
  });

  it("keeps the public-file path reserved, and serves nothing in production or from a private-only bucket", async () => {
    const read = vi.fn(() => { throw new Error("must not resolve"); });
    for (const options of [{ mode: "production" }, { r2: { name: "test-files" } }, { r2: null }]) {
      const application = app((_req, res) => res.text("route"), options);
      const response = await application.fetch(request("/_goribu/r2/public/key"), { get R2() { return read(); } }, ctx);
      expect(response.status).toBe(404);
    }
    const application = app((_req, res) => res.text("route"));
    for (const path of ["/_goribu/r2/private/key", "/_goribu/r2", "/_goribu/r2/public/"]) {
      expect((await application.fetch(request(path), {}, ctx)).status).toBe(404);
    }
    const invalid = await application.fetch(request("/_goribu/r2/public/%zz"), {}, ctx);
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toContain("req.r2.url(key)");
    const mutation = await application.fetch(request("/_goribu/r2/public/key", { method: "PUT", body: "no" }), {}, ctx);
    expect(mutation.status).toBe(405);
    expect(mutation.headers.get("allow")).toBe("GET, HEAD");
    expect(read).not.toHaveBeenCalled();
  });
});
