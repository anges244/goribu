import { describe, expect, it } from "vitest";
import { createR2ManagementClient } from "../src/build/cloudflare-r2.js";

const access = { accountId: "a".repeat(32), headers: { Authorization: "Bearer test-token" } };
const origin = "https://app.example.com";
const external = { id: "images", allowed: { origins: ["https://gallery.example.com"], methods: ["GET"], headers: ["range"] }, exposeHeaders: ["etag"], maxAgeSeconds: 42 };

function fixture(initial, override = () => undefined) {
  let rules = structuredClone(initial);
  const calls = [];
  const client = createR2ManagementClient({ access, fetch: async (url, init) => {
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${access.accountId}/r2/buckets/app-files/cors`);
    expect(init.redirect).toBe("error");
    expect(init.headers.Authorization).toBe(access.headers.Authorization);
    const call = { method: init.method, jurisdiction: init.headers["cf-r2-jurisdiction"], body: init.body && JSON.parse(init.body) };
    calls.push(call);
    const replacement = override(call, calls.length);
    if (replacement) return replacement;
    if (init.method === "PUT") rules = call.body.rules;
    else expect(init.method).toBe("GET");
    return Response.json({ success: true, result: init.method === "PUT" ? {} : { rules } });
  } });
  return { client, calls, rules: () => rules };
}

describe("managed R2 upload CORS", () => {
  it("plans and installs the first policy when R2 reports no CORS configuration", async () => {
    const remote = fixture([], (call, count) => count <= 2
      ? Response.json({ success: false, errors: [{ code: 10059 }] }, { status: 404 })
      : undefined);
    await expect(remote.client.cors("app-files", "default")).resolves.toEqual([]);
    await expect(remote.client.upsertUploadCors("app-files", "default", [origin])).resolves.toBe(true);
    expect(remote.calls.map((call) => call.method)).toEqual(["GET", "GET", "PUT", "GET"]);
    expect(remote.rules()).toEqual([{
      id: "goribu-uploads", allowed: { origins: [origin], methods: ["PUT"],
        headers: ["content-type", "cache-control", "if-none-match", "x-amz-meta-goribu-upload"] }, maxAgeSeconds: 3600,
    }]);
    await expect(remote.client.upsertUploadCors("app-files", "default", [origin])).resolves.toBe(false);
  });

  it.each(["default", "eu"])("preserves other rules and performs an idempotent, verified upsert (%s)", async (jurisdiction) => {
    const remote = fixture([external, { id: "goribu-uploads", allowed: { origins: ["https://old.example.com"], methods: ["PUT"] } }]);
    await expect(remote.client.upsertUploadCors("app-files", jurisdiction, [origin, origin])).resolves.toBe(true);
    expect(remote.calls.map((call) => call.method)).toEqual(["GET", "PUT", "GET"]);
    expect(remote.calls.every((call) => call.jurisdiction === jurisdiction)).toBe(true);
    expect(remote.rules()).toEqual([external, {
      id: "goribu-uploads", allowed: { origins: [origin], methods: ["PUT"],
        headers: ["content-type", "cache-control", "if-none-match", "x-amz-meta-goribu-upload"] }, maxAgeSeconds: 3600,
    }]);
    await expect(remote.client.upsertUploadCors("app-files", jurisdiction, [origin])).resolves.toBe(false);
    expect(remote.calls.map((call) => call.method)).toEqual(["GET", "PUT", "GET", "GET"]);
  });

  it("reads again before writing and retains newly added unrelated settings", async () => {
    const remote = fixture([], (call, count) => {
      if (count === 2) return Response.json({ success: true, result: { rules: [external] } });
    });
    expect(await remote.client.cors("app-files", "default")).toEqual([]);
    await remote.client.upsertUploadCors("app-files", "default", [origin]);
    expect(remote.rules()[0]).toEqual(external);
  });

  it.each([
    undefined,
    [null],
    [{ allowed: { origins: [origin], methods: "PUT" } }],
    [{ allowed: { origins: [origin], methods: ["PUT"] }, maxAgeSeconds: -1 }],
    [1, 2].map(() => ({ id: "goribu-uploads", allowed: { origins: [origin], methods: ["PUT"] } })),
  ])("fails closed on unreadable or ambiguous CORS state %#", async (rules) => {
    const remote = fixture(rules);
    await expect(remote.client.upsertUploadCors("app-files", "default", [origin])).rejects.toThrow("[Goribu] Cloudflare returned invalid or ambiguous R2 CORS rules");
    expect(remote.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it.each([
    [404, false, [10006]],
    [404, false, [99999]],
    [403, false, [10059]],
    [404, false, [10059, 10006]],
    [404, true, [10059]],
  ])("rejects an ambiguous or unrelated CORS failure (%s/%s/%j)", async (status, success, codes) => {
    const remote = fixture([], () => Response.json({ success,
      errors: codes.map((code) => ({ code, message: "untrusted-api-text" })),
    }, { status }));
    for (const read of [() => remote.client.cors("app-files", "default"),
      () => remote.client.upsertUploadCors("app-files", "default", [origin])]) {
      let error;
      try { await read(); } catch (cause) { error = cause; }
      expect(error?.message).toContain(`HTTP ${status}`);
      expect(error?.message).not.toContain("untrusted-api-text");
    }
    expect(remote.calls.map((call) => call.method)).toEqual(["GET", "GET"]);
  });

  it("does not mistake a successful null result for the missing-policy error", async () => {
    const remote = fixture([], () => Response.json({ success: true, result: null }));
    await expect(remote.client.cors("app-files", "default")).rejects.toThrow("invalid or ambiguous R2 CORS rules");
    await expect(remote.client.upsertUploadCors("app-files", "default", [origin])).rejects.toThrow("invalid or ambiguous R2 CORS rules");
    expect(remote.calls.map((call) => call.method)).toEqual(["GET", "GET"]);
  });

  it("rejects a policy still missing after a successful write", async () => {
    const remote = fixture([], (call, count) => count === 3
      ? Response.json({ success: false, errors: [{ code: 10059 }] }, { status: 404 })
      : undefined);
    await expect(remote.client.upsertUploadCors("app-files", "default", [origin])).rejects.toThrow("CORS update could not be confirmed");
    expect(remote.calls.map((call) => call.method)).toEqual(["GET", "PUT", "GET"]);
  });

  it("stops after a failed read-back without retrying from the old snapshot", async () => {
    const remote = fixture([external], (call, count) => count === 3 ? Response.json({ success: true, result: { rules: [] } }) : undefined);
    await expect(remote.client.upsertUploadCors("app-files", "eu", [origin])).rejects.toThrow("CORS update could not be confirmed");
    expect(remote.calls.map((call) => call.method)).toEqual(["GET", "PUT", "GET"]);
  });

  it.each([[], ["*"], ["https://*.example.com"], ["https://app.example.com/path"], ["https://user:password@app.example.com"]])("refuses an unverified origin set %# before writing", async (origins) => {
    const remote = fixture([]);
    await expect(remote.client.upsertUploadCors("app-files", "default", origins)).rejects.toThrow("verified application origins");
    expect(remote.calls.map((call) => call.method)).toEqual(["GET"]);
  });
});
