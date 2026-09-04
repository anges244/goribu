import { describe, expect, it, vi } from "vitest";
import { createKV } from "../src/runtime/create-kv.js";
import { createApp } from "goribu/server";

function namespace() {
  return {
    get: vi.fn(async function () { return this.value; }),
    getWithMetadata: vi.fn(async function () { return { value: this.value, metadata: { source: "test" } }; }),
    put: vi.fn(async function (_key, value) { this.value = value; }),
    list: vi.fn(async () => ({ keys: [], list_complete: false, cursor: "next-page" })),
    delete: vi.fn(async function () { this.value = null; }),
    value: "initial",
  };
}

describe("request KV facade", () => {
  it("resolves once on first use, preserves native receivers, and isolates requests", async () => {
    const first = namespace();
    const second = namespace();
    second.value = "second";
    const read = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
    const env = { get KV() { return read(); } };
    const kv = createKV(env);
    const other = createKV(env);
    const { get, put, list, delete: remove } = kv;
    expect(read).not.toHaveBeenCalled();
    await put("key", "changed");
    await expect(get("key")).resolves.toBe("changed");
    await expect(list({ cursor: "previous" })).resolves.toEqual({ keys: [], list_complete: false, cursor: "next-page" });
    await remove("key");
    await expect(get("key")).resolves.toBeNull();
    expect(read).toHaveBeenCalledOnce();
    await expect(other.get("key")).resolves.toBe("second");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("passes native value/options and metadata reads through without serialization or retries", async () => {
    const binding = namespace();
    const kv = createKV({ KV: binding });
    const bytes = new Uint8Array([0, 255]);
    const putOptions = { expirationTtl: 120, metadata: { source: "test" } };
    await kv.put("key", bytes, putOptions);
    expect(binding.put).toHaveBeenCalledWith("key", bytes, putOptions);
    const getOptions = { type: "arrayBuffer", cacheTtl: 60, metadata: true };
    await expect(kv.get("key", getOptions)).resolves.toEqual({ value: bytes, metadata: { source: "test" } });
    expect(binding.getWithMetadata).toHaveBeenCalledWith("key", { type: "arrayBuffer", cacheTtl: 60 });
    expect(getOptions.metadata).toBe(true);
    await kv.list({ prefix: "a", limit: 1, cursor: "next" });
    expect(binding.list).toHaveBeenCalledWith({ prefix: "a", limit: 1, cursor: "next" });
    const failed = new Error("platform write failed");
    binding.put.mockRejectedValue(failed);
    await expect(kv.put("key", "new")).rejects.toBe(failed);
    expect(binding.put).toHaveBeenCalledTimes(2);
  });

  it("rejects every operation through the missing-binding stub and keeps that resolution stable", async () => {
    for (const absent of [undefined, null]) {
      const env = { KV: absent };
      const kv = createKV(env);
      const operations = [() => kv.get("key"), () => kv.get("key", { metadata: true }), () => kv.put("key", "value"), () => kv.list(), () => kv.delete("key")];
      for (const run of operations) {
        await expect(run()).rejects.toThrow(/\[Goribu\].*Expected env.KV.*goribu.config.js.*goribu deploy/);
      }
      env.KV = namespace();
      await expect(kv.get("key")).rejects.toThrow(/no KV binding/);
      await expect(createKV(env).get("key")).resolves.toBe("initial");
    }
  });

  it("teaches repairs for malformed bindings and unsupported facade calls", async () => {
    const read = vi.fn(() => namespace());
    const kv = createKV({ get KV() { return read(); } });
    await expect(kv.get(["one", "two"])).rejects.toThrow(/single key/);
    await expect(kv.get("key", "json")).rejects.toThrow(/options must be an object/);
    await expect(kv.get("key", { metadata: "yes" })).rejects.toThrow(/metadata must be true or false/);
    await expect(kv.put("key", "value", { ttl: 120 })).rejects.toThrow(/unsupported option ttl.*expirationTtl/);
    expect(read).not.toHaveBeenCalled();
    await expect(createKV({ KV: {} }).get("key")).rejects.toThrow(/not a Workers KV namespace.*Pass the Worker env unchanged/);
  });
});

const route = { id: "kv", pattern: "/kv", segments: [{ type: "static", value: "kv" }], methods: ["GET"], hasDefaultExport: false };
function app(GET, middleware = []) {
  return createApp({
    mode: "development", manifest: [route], errorPages: { notFound: null, serverError: null },
    middlewareByRoute: new Map([[route.id, middleware.length ? [{ id: "middleware", relativePath: "_middleware.js" }] : []]]),
    modules: new Map([[route.id, { GET }], ["middleware", { default: middleware }]]),
  });
}
const request = () => new Request("https://goribu.test/kv");
const ctx = { waitUntil() {} };

describe("KV through the Worker request boundary", () => {
  it("shares the lazy facade between middleware and handler, but never between fetches", async () => {
    const facades = [];
    const application = app(async (req, res) => {
      expect(req.kv).toBe(facades.at(-1));
      return res.text(await req.kv.get("key"));
    }, [async (req) => { facades.push(req.kv); await req.kv.put("key", req.headers.get("x-value")); }]);
    const bindings = [namespace(), namespace()];
    for (const [index, binding] of bindings.entries()) {
      const read = vi.fn(() => binding);
      const response = await application.fetch(new Request(request(), { headers: { "x-value": String(index) } }), { get KV() { return read(); } }, ctx);
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe(String(index));
      expect(read).toHaveBeenCalledOnce();
    }
    expect(facades[0]).not.toBe(facades[1]);
  });

  it("does not resolve unused KV and routes missing-binding failures through the error boundary", async () => {
    const read = vi.fn(() => { throw new Error("unused binding"); });
    const plain = app((_req, res) => res.text("no KV"));
    for (const path of ["/kv", "/missing"]) {
      const response = await plain.fetch(new Request(`https://goribu.test${path}`), { get KV() { return read(); } }, ctx);
      expect(response.status).toBe(path === "/kv" ? 200 : 404);
    }
    expect(read).not.toHaveBeenCalled();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const application = app(async (req, res) => res.text(await req.kv.get("key")));
      const response = await application.fetch(request(), {}, ctx);
      expect(response.status).toBe(500);
      expect(await response.text()).toContain("Expected env.KV");
    } finally { consoleError.mockRestore(); }
  });
});
