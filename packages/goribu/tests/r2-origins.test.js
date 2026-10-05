import { describe, expect, it } from "vitest";
import { createR2ManagementClient } from "../src/build/cloudflare-r2.js";

const accountId = "a".repeat(32), zoneId = "b".repeat(32);
function fixture({ enabled = false, domains = [], routes = [], override = () => undefined } = {}) {
  const calls = [];
  const client = createR2ManagementClient({ access: { accountId, headers: {} }, fetch: async (url, init) => {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(`/client/v4/accounts/${accountId}`, "").replace("/client/v4", "");
    calls.push(path);
    expect(init.method).toBe("GET");
    expect(init.headers["cf-r2-jurisdiction"]).toBeUndefined();
    const replacement = override(path, parsed.searchParams);
    if (replacement) return replacement;
    let result;
    if (path === "/workers/scripts/my-app/subdomain") result = { enabled };
    else if (path === "/workers/subdomain") result = { subdomain: "account-name" };
    else if (path === "/workers/domains") {
      expect(Object.fromEntries(parsed.searchParams)).toEqual({ service: "my-app", environment: "production", page: "1", per_page: "50" });
      result = domains;
    } else if (path === "/zones") {
      expect(parsed.searchParams.get("account.id")).toBe(accountId);
      result = [{ id: zoneId, name: "example.com", account: { id: accountId } }];
    } else if (path === `/zones/${zoneId}/workers/routes`) result = routes;
    else throw new Error(`Unexpected request ${path}`);
    return Response.json({ success: true, result });
  } });
  return { client, calls };
}

describe("R2 application origin discovery", () => {
  it("combines enabled workers.dev, matching Worker domains and exact-host routes without broadening wildcard hosts", async () => {
    const remote = fixture({ enabled: true, domains: [{ hostname: "app.example.com", service: "my-app", environment: "production" }],
      routes: [
        { pattern: "app.example.com/*", script: "my-app" },
        { pattern: "https://forms.example.com/send*", script: "my-app" },
        { pattern: "http://legacy.example.com/*", script: "my-app" },
        { pattern: "https://*.example.com/*", script: "my-app" },
        { pattern: "*example.com/*", script: "my-app" },
        { pattern: "other.example.com/*", script: "other-app" },
        { pattern: "excluded.example.com/*" },
      ] });
    const found = await remote.client.origins("my-app", true, true);
    expect(found.origins).toEqual(["http://app.example.com", "http://legacy.example.com", "https://app.example.com", "https://forms.example.com", "https://my-app.account-name.workers.dev"]);
    expect(found.warnings).toHaveLength(2);
    expect(found.warnings.every((warning) => warning.includes("Skipped wildcard-host"))).toBe(true);
  });

  it("predicts workers.dev for both missing Workers and existing disabled Workers", async () => {
    const remote = fixture();
    expect(await remote.client.origins("my-app", false, true)).toEqual({ origins: ["https://my-app.account-name.workers.dev"], warnings: [], expectedAfterFirstDeploy: true });
    expect(remote.calls).toEqual(["/workers/subdomain"]);
    remote.calls.length = 0;
    expect(await remote.client.origins("my-app", true, true)).toEqual({ origins: ["https://my-app.account-name.workers.dev"], warnings: [], enabledByDeploy: "https://my-app.account-name.workers.dev" });
    expect(remote.calls).toContain("/workers/subdomain");
  });

  it("leaves out workers.dev and its account subdomain when the app disables it", async () => {
    const remote = fixture({ enabled: true, domains: [{ hostname: "app.example.com", service: "my-app", environment: "production" }],
      override: (path) => path === "/workers/subdomain" ? Response.json({ success: false, errors: [{ code: 10007 }] }, { status: 404 }) : undefined });
    expect(await remote.client.origins("my-app", false, false)).toEqual({ origins: [], warnings: [] });
    expect(await remote.client.origins("my-app", true, false)).toEqual({ origins: ["https://app.example.com"], warnings: [] });
    expect(remote.calls.filter((path) => path.includes("subdomain"))).toEqual([]);
  });

  it("blocks a missing account subdomain and never mistakes a generic 404 for absence", async () => {
    const missing = fixture({ override: (path) => path === "/workers/subdomain" ? Response.json({ success: false, errors: [{ code: 10007 }] }, { status: 404 }) : undefined });
    await expect(missing.client.origins("my-app", false, true)).rejects.toThrow("Register one in Cloudflare Workers & Pages");
    await expect(missing.client.origins("my-app", true, true)).rejects.toThrow("Register one in Cloudflare Workers & Pages");
    const unknown = fixture({ override: (path) => path === "/workers/subdomain" ? Response.json({ success: false, errors: [{ code: 99999 }] }, { status: 404 }) : undefined });
    await expect(unknown.client.origins("my-app", false, true)).rejects.toThrow("HTTP 404");
  });

  it("follows domain, zone and route pages beyond 50 entries while keeping filters and account scope", async () => {
    const zones = Array.from({ length: 51 }, (_, i) => ({ id: (i + 1).toString(16).padStart(32, "0"), name: `zone${i}.example.com`, account: { id: accountId } }));
    const domains = Array.from({ length: 51 }, (_, i) => ({ id: `d${i}`, service: "my-app", environment: "production", hostname: `d${i}.example.com` }));
    const routes = Array.from({ length: 51 }, (_, i) => ({ id: `r${i}`, script: "my-app", pattern: `https://r${i}.zone50.example.com/*` }));
    const requested = [];
    const remote = fixture({ override: (path, query) => {
      let items;
      if (path === "/zones") { expect(query.get("account.id")).toBe(accountId); items = zones; }
      else if (path === "/workers/domains") { expect(query.get("service")).toBe("my-app"); expect(query.get("environment")).toBe("production"); items = domains; }
      else if (path.endsWith("/routes")) items = path.includes(zones[50].id) ? routes : [];
      else return;
      const page = Number(query.get("page"));
      expect(query.get("per_page")).toBe("50");
      requested.push([path, page]);
      const result = items.slice((page - 1) * 50, page * 50);
      return Response.json({ success: true, result, result_info: { page, per_page: 50, count: result.length, total_count: items.length, total_pages: Math.ceil(items.length / 50) } });
    } });
    const found = await remote.client.origins("my-app", true, true);
    expect(found.origins).toHaveLength(103);
    expect(found.origins).toContain("https://r50.zone50.example.com");
    expect(found.origins).toContain("https://d50.example.com");
    expect(requested.filter(([, page]) => page === 2)).toEqual([["/workers/domains", 2], ["/zones", 2], [`/zones/${zones[50].id}/workers/routes`, 2]]);
  });

  it.each(["repeat", "changed totals", "missing page", "wrong page"])("refuses an incomplete paginated inventory: %s", async (fault) => {
    const remote = fixture({ override: (path, query) => {
      if (path !== "/workers/domains") return;
      const page = Number(query.get("page"));
      const result = page === 2 && fault === "missing page" ? [] : [{ id: page === 2 && fault !== "repeat" ? "second" : "first", hostname: "app.example.com", service: "my-app", environment: "production" }];
      return Response.json({ success: true, result, result_info: { page: fault === "wrong page" ? 1 : page, count: result.length, total_count: page === 2 && fault === "changed totals" ? 3 : 2, total_pages: 2 } });
    } });
    await expect(remote.client.origins("my-app", true, true)).rejects.toThrow("partial inventory");
  });

  it.each([
    ["/workers/domains", [{ hostname: "attacker.example", service: "another-app", environment: "production" }]],
    ["/workers/domains", [{ hostname: "app.example.com", service: "my-app", environment: "preview" }]],
    ["/workers/domains", [{ hostname: "https://app.example.com", service: "my-app", environment: "production" }]],
    ["/workers/scripts/my-app/subdomain", {}],
    ["/zones", [{ id: zoneId, name: "example.com", account: { id: "c".repeat(32) } }]],
    [`/zones/${zoneId}/workers/routes`, [{ script: "my-app", pattern: "https://app.other.com/*" }]],
  ])("rejects invalid ownership or metadata at %s %#", async (path, result) => {
    const remote = fixture({ override: (current) => current === path ? Response.json({ success: true, result }) : undefined });
    await expect(remote.client.origins("my-app", true, true)).rejects.toThrow("Could not verify a complete inventory");
  });

  it("fails closed on a partial inventory or denied route permission", async () => {
    const partial = fixture({ override: (path) => path === "/workers/domains" ? Response.json({ success: true, result: [], result_info: { total_pages: 2 } }) : undefined });
    await expect(partial.client.origins("my-app", true, true)).rejects.toThrow("partial inventory");
    const denied = fixture({ override: (path) => path.endsWith("/routes") ? Response.json({ success: false, errors: [{ code: 10000 }] }, { status: 403 }) : undefined });
    await expect(denied.client.origins("my-app", true, true)).rejects.toThrow("Workers Routes Read");
  });
});
