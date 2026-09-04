import { describe, expect, it, vi } from "vitest";
import { loadCommunityFeedback } from "../../../site/src/community.server.js";

describe("community feedback cache", () => {
  it("serves a cached snapshot without touching D1 or refreshing its lifetime", async () => {
    const snapshot = { entries: [], generatedAt: "2026-09-04T00:00:00.000Z" };
    const req = { kv: { get: vi.fn(async () => snapshot), put: vi.fn() } };
    Object.defineProperty(req, "d1", { get() { throw new Error("cache hit must not read D1"); } });
    await expect(loadCommunityFeedback(req)).resolves.toBe(snapshot);
    expect(req.kv.put).not.toHaveBeenCalled();
  });

  it("returns the database snapshot when a competing cache fill is rejected", async () => {
    const entries = [{ id: 1, message: "Hello", createdAt: "2026-09-04T00:00:00.000Z" }];
    const req = {
      kv: { get: async () => null, put: vi.fn(async () => { throw new Error("KV PUT failed: 429"); }) },
      d1: { public: () => ({ all: async () => entries }) },
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const snapshot = await loadCommunityFeedback(req);
      expect(snapshot.entries).toEqual(entries);
      expect(req.kv.put).toHaveBeenCalledWith("community-feedback:v1", JSON.stringify(snapshot), { expirationTtl: 300 });
      expect(log).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });
});
