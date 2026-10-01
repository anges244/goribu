import { describe, expect, it, vi } from "vitest";
import { createCache } from "../src/runtime/create-cache.js";

const requestUrl = "https://goribu.test/current-page";

function cacheStorage() {
  const entries = new Map();
  const key = (request) => {
    const url = new URL(typeof request === "string" ? request : request.url);
    url.hash = "";
    return url.href;
  };
  const cache = {
    match: vi.fn(async (request) => entries.get(key(request))?.clone()),
    put: vi.fn(async (request, response) => { entries.set(key(request), response.clone()); }),
    delete: vi.fn(async (request) => entries.delete(key(request))),
  };
  return { cache, open: vi.fn(async () => cache) };
}

function modes() {
  const storage = cacheStorage();
  return {
    storage,
    facades: [
      createCache(storage, requestUrl),
      createCache(undefined, requestUrl),
      createCache(storage, requestUrl, { prerender: true }),
    ],
  };
}

describe("request cache facade", () => {
  it("opens lazily once, round-trips JSON, and applies default or explicit TTLs", async () => {
    const storage = cacheStorage();
    const cache = createCache(storage, requestUrl);
    const { get, set } = cache;
    expect(Object.isFrozen(cache)).toBe(true);
    expect(cache).not.toHaveProperty("raw");
    expect(storage.open).not.toHaveBeenCalled();

    await Promise.all([
      set("/polls", { items: [1, 2] }),
      set("/count", 0, { ttl: 300 }),
    ]);
    expect(storage.open).toHaveBeenCalledExactlyOnceWith("goribu:data:v1");
    await expect(get("/polls")).resolves.toEqual({ items: [1, 2] });
    await expect(get("/count")).resolves.toBe(0);
    await expect(get("/missing")).resolves.toBeNull();
    expect(storage.cache.put.mock.calls.map(([, response]) => response.headers.get("Cache-Control")))
      .toEqual(["max-age=60", "max-age=300"]);

    for (const value of [false, "", null]) {
      await set("/value", value);
      await expect(get("/value")).resolves.toBe(value);
    }
    await set("/value", {
      date: new Date("2026-10-02T00:00:00.000Z"),
      omitted: undefined,
      items: [undefined, Infinity],
    });
    await expect(get("/value")).resolves.toEqual({
      date: "2026-10-02T00:00:00.000Z",
      items: [null, null],
    });
    expect(storage.open).toHaveBeenCalledOnce();
  });

  it("keeps opaque keys distinct and scopes entries to the request origin", async () => {
    const storage = cacheStorage();
    const cache = createCache(storage, requestUrl);
    const keys = ["/item", "/group/../item", "/%2e%2e/item", "/item#one", "/item#two", "/item?lang=el"];
    for (const [index, key] of keys.entries()) await cache.set(key, index);
    for (const [index, key] of keys.entries()) await expect(cache.get(key)).resolves.toBe(index);

    const sameOrigin = createCache(storage, "https://goribu.test/another-page");
    const otherOrigin = createCache(storage, "https://other.goribu.test/current-page");
    await expect(sameOrigin.get("/item")).resolves.toBe(0);
    await expect(otherOrigin.get("/item")).resolves.toBeNull();
    await otherOrigin.set("/item", "other host");
    await expect(cache.get("/item")).resolves.toBe(0);
    await expect(otherOrigin.get("/item")).resolves.toBe("other host");
  });

  it("rejects invalid keys and TTL options before touching any cache, including in no-op modes", async () => {
    const { storage, facades } = modes();
    for (const cache of facades) {
      for (const key of ["", "polls", null, 1]) {
        await expect(cache.get(key)).rejects.toThrow(/\[Goribu\]/);
        await expect(cache.set(key, "value")).rejects.toThrow(/\[Goribu\]/);
        await expect(cache.delete("/valid", key)).rejects.toThrow(/\[Goribu\]/);
      }
      for (const ttl of [0, -1, 0.5, Infinity, NaN, "60", Number.MAX_SAFE_INTEGER + 1]) {
        await expect(cache.set("/valid", "value", { ttl })).rejects.toThrow(/\[Goribu\].*ttl/);
      }
      for (const options of [null, [], 60, { cacheTtl: 60 }]) {
        await expect(cache.set("/valid", "value", options)).rejects.toThrow(/\[Goribu\]/);
      }
    }
    expect(storage.open).not.toHaveBeenCalled();
  });

  it("rejects values that cannot produce JSON before touching any cache, including in no-op modes", async () => {
    const circular = {};
    circular.self = circular;
    const values = [undefined, () => {}, Symbol("value"), 1n, circular, { toJSON: () => undefined }];
    const { storage, facades } = modes();
    for (const cache of facades) {
      for (const value of values) {
        await expect(cache.set("/value", value)).rejects.toThrow(/\[Goribu\]/);
      }
    }
    expect(storage.open).not.toHaveBeenCalled();
  });

  it("misses and skips valid writes when caches are absent or the request is prerendered", async () => {
    const storage = cacheStorage();
    for (const cache of [
      createCache(undefined, requestUrl),
      createCache(storage, requestUrl, { prerender: true }),
    ]) {
      await expect(cache.get("/value")).resolves.toBeNull();
      await expect(cache.set("/value", { fresh: true })).resolves.toBeUndefined();
      await expect(cache.delete("/value", "/other")).resolves.toBeUndefined();
    }
    expect(storage.open).not.toHaveBeenCalled();
  });

  it("warns and degrades gracefully for platform and cached-body failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const storage = cacheStorage();
      storage.open.mockRejectedValue(new Error("cache unavailable"));
      const unavailable = createCache(storage, requestUrl);
      await expect(unavailable.get("/value")).resolves.toBeNull();
      await expect(unavailable.set("/value", "fresh")).resolves.toBeUndefined();
      await expect(unavailable.delete("/value")).resolves.toBeUndefined();
      expect(storage.open).toHaveBeenCalledOnce();

      const available = cacheStorage();
      const cache = createCache(available, requestUrl);
      available.cache.match.mockRejectedValueOnce(new Error("read failed"));
      await expect(cache.get("/value")).resolves.toBeNull();
      available.cache.match.mockResolvedValueOnce(new Response("invalid JSON"));
      await expect(cache.get("/value")).resolves.toBeNull();
      available.cache.put.mockRejectedValueOnce(new Error("write failed"));
      await expect(cache.set("/value", "fresh")).resolves.toBeUndefined();
      available.cache.delete.mockRejectedValueOnce(new Error("delete failed"));
      await expect(cache.delete("/value")).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
      for (const [message] of warn.mock.calls) expect(message).toMatch(/^\[Goribu\]/);
    } finally { warn.mockRestore(); }
  });

  it("validates the entire deletion batch before removing entries, then removes valid keys in parallel", async () => {
    const storage = cacheStorage();
    const cache = createCache(storage, requestUrl);
    await cache.set("/one", 1);
    await cache.set("/two", 2);
    await expect(cache.delete("/one", "invalid", "/two")).rejects.toThrow(/\[Goribu\]/);
    expect(storage.cache.delete).not.toHaveBeenCalled();
    await expect(cache.get("/one")).resolves.toBe(1);
    await expect(cache.get("/two")).resolves.toBe(2);

    const remove = storage.cache.delete.getMockImplementation();
    const pending = [];
    storage.cache.delete.mockImplementation((request) => new Promise((resolve) => {
      pending.push(() => resolve(remove(request)));
    }));
    const deleting = cache.delete("/one", "/two");
    try {
      await vi.waitFor(() => expect(storage.cache.delete).toHaveBeenCalledTimes(2));
    } finally {
      for (const finish of pending) finish();
    }
    await deleting;
    await expect(cache.get("/one")).resolves.toBeNull();
    await expect(cache.get("/two")).resolves.toBeNull();
  });
});
