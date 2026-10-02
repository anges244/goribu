import { describe, expect, it, vi } from "vitest";
import { createAppDomainManagementClient } from "../src/build/cloudflare-app-domain.js";
import { formatAppDomainPlan, inspectAppDomain } from "../src/build/inspect-app-domain.js";
import { provisionAppDomain } from "../src/build/provision-app-domain.js";

const accountId = "a".repeat(32), zoneId = "b".repeat(32);
const access = { accountId, headers: { Authorization: "Bearer private-test-credential" } };
const appConfig = { name: "test-app", domain: "app.example.com" };
const zone = { id: zoneId, name: "example.com", account: { id: accountId }, status: "active" };
const domain = (overrides = {}) => ({ id: "c".repeat(32), hostname: appConfig.domain,
  service: appConfig.name, environment: "production", zone_id: zoneId, ...overrides });
const previewPath = "/workers/scripts/test-app/domains/changeset";
const attachmentPath = "/workers/scripts/test-app/domains/records";
const changeset = (overrides = {}) => ({ added: [domain({ environment: "" })], updated: [], removed: [], conflicting: [], ...overrides });
const success = (result, result_info) => Response.json({ success: true, result, ...(result_info && { result_info }) });
const failure = () => Response.json({ success: false, errors: [{ code: 10000, message: "untrusted-response-marker" }] }, { status: 403 });

// POST previews are read-only. The guarded native PUT is the only write;
// direct DNS operations and domain deletion are never supported here.
function cloudflare({ domains = [], zones = [zone], override = () => undefined } = {}) {
  const calls = [], state = { domains: [...domains] };
  const fetch = async (url, init) => {
    expect(init.redirect).toBe("error");
    expect(init.headers.Authorization).toBe(access.headers.Authorization);
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://api.cloudflare.com");
    const path = parsed.pathname.replace("/client/v4", "").replace(`/accounts/${accountId}`, "");
    const call = { path, method: init.method, query: Object.fromEntries(parsed.searchParams), body: init.body && JSON.parse(init.body) };
    calls.push(call);
    const replaced = override(call, state);
    if (replaced !== undefined) return replaced;
    if (path === "/zones" && init.method === "GET") {
      expect(call.query["account.id"]).toBe(accountId);
      return success(zones.filter((entry) => entry.name === call.query.name));
    }
    if (path === "/workers/domains" && init.method === "GET") {
      expect(call.query.service).toBeUndefined();
      expect(call.query.environment).toBeUndefined();
      return success(state.domains);
    }
    const selectedZone = [...zones].sort((a, b) => b.name.length - a.name.length)
      .find((entry) => appConfig.domain === entry.name || appConfig.domain.endsWith(`.${entry.name}`));
    if (path === previewPath && init.method === "POST") {
      expect(call.query).toEqual({ replace_state: "false" });
      expect(call.body).toEqual([{ hostname: appConfig.domain, zone_id: selectedZone.id }]);
      return success(changeset({ added: [domain({ environment: "", zone_id: selectedZone.id })] }));
    }
    if (path === attachmentPath && init.method === "PUT") {
      expect(call.body).toEqual({ override_scope: false, override_existing_origin: false,
        override_existing_dns_record: false, origins: [{ hostname: appConfig.domain, zone_id: selectedZone.id }] });
      const attached = domain({ zone_id: selectedZone.id });
      state.domains.push(attached);
      return success(null);
    }
    throw new Error(`Unexpected management operation ${init.method} ${path}`);
  };
  let output = "";
  const options = { projectRoot: "/unused", appConfig, access, fetch,
    stdout: { write(text) { output += text; } } };
  return { options, calls, state, output: () => output };
}

describe("application domain planning and attachment", () => {
  it("does nothing without a configured domain, including auth lookup", async () => {
    const getAccess = vi.fn(), fetch = vi.fn();
    const options = { appConfig: { name: "test-app" }, getAccess, fetch };
    expect(await inspectAppDomain(options)).toBeNull();
    expect(await provisionAppDomain(options)).toBeNull();
    expect(formatAppDomainPlan(null)).toBe("");
    expect(getAccess).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("plans with reads, attaches once, verifies ownership and preserves other domains on repeat deploy", async () => {
    const previous = domain({ id: "d".repeat(32), hostname: "old.example.com" });
    const remote = cloudflare({ domains: [previous] });
    const plan = await inspectAppDomain(remote.options);
    expect(plan).toMatchObject({ name: appConfig.domain, worker: appConfig.name, accountId, zoneId, action: "connect" });
    expect(formatAppDomainPlan(plan)).toContain("connect domain  app.example.com -> test-app");
    expect(plan.warnings).toEqual([]);
    expect(formatAppDomainPlan(plan)).toContain("also connected  old.example.com (not managed by Goribu)");
    expect(formatAppDomainPlan(plan)).not.toContain("Warning:");
    expect(remote.calls.filter((call) => call.method !== "GET")).toEqual([
      { path: previewPath, method: "POST", query: { replace_state: "false" }, body: [{ hostname: appConfig.domain, zone_id: zoneId }] },
    ]);

    await provisionAppDomain(remote.options);
    expect(remote.output()).toContain("Connected app domain https://app.example.com; DNS and certificate activation may still be pending.");
    expect(remote.calls.at(-1)).toMatchObject({ method: "GET", path: "/workers/domains" });
    const before = remote.calls.length;
    expect((await provisionAppDomain(remote.options)).action).toBe("none");
    expect(remote.calls.slice(before).every((call) => call.method === "GET")).toBe(true);
    expect(remote.calls.some((call) => call.path.includes("/dns_records"))).toBe(false);
    expect(remote.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
    expect(remote.state.domains).toEqual([previous, domain()]);
  });

  it("uses the most specific active zone in the deployment account", async () => {
    const specific = { ...zone, id: "f".repeat(32), name: appConfig.domain };
    const remote = cloudflare({ zones: [zone, specific] });
    expect((await inspectAppDomain(remote.options)).zoneId).toBe(specific.id);
    expect(remote.calls.filter((call) => call.path === "/zones")).toHaveLength(1);
  });

  it.each([
    ["another Worker", domain({ service: "another-app" })],
    ["another environment", domain({ environment: "staging" })],
    ["another zone", domain({ zone_id: "f".repeat(32) })],
  ])("refuses a hostname owned by %s", async (_name, existing) => {
    const remote = cloudflare({ domains: [existing] });
    await expect(provisionAppDomain(remote.options)).rejects.toThrow(/already connected.*does not reassign/);
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
    expect(remote.state.domains).toEqual([existing]);
  });

  it("refuses Cloudflare-reported DNS and Worker conflicts without printing response data", async () => {
    for (const [preview, message] of [
      [changeset({ conflicting: [domain({ external_dns_record_id: "private-dns-value" })] }), /DNS.*conflict/],
      [changeset({ added: [], updated: [domain({ environment: "", modified: true })] }), /already assigned/],
    ]) {
      const remote = cloudflare({ override: (call) => call.path === previewPath ? success(preview) : undefined });
      const error = await provisionAppDomain(remote.options).catch((error) => error);
      expect(error.message).toMatch(message);
      expect(error.message).not.toContain("private-dns-value");
      expect(remote.calls.some((call) => call.method === "PUT")).toBe(false);
    }
  });

  it.each(["owner", "DNS"])("rereads %s conflicts after a clean pre-deploy plan", async (conflict) => {
    let dnsConflict = false;
    const remote = cloudflare({ override: (call) => call.path === previewPath && dnsConflict
      ? success(changeset({ conflicting: [domain({ environment: "" })] })) : undefined });
    expect((await inspectAppDomain(remote.options)).action).toBe("connect");
    if (conflict === "owner") remote.state.domains.push(domain({ service: "racing-app" }));
    else dnsConflict = true;
    await expect(provisionAppDomain(remote.options)).rejects.toThrow(/already connected|DNS.*conflict/);
    expect(remote.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("keeps server conflict protection enabled if ownership changes after the last preview", async () => {
    const remote = cloudflare({ override: (call) => call.path === attachmentPath
      ? Response.json({ success: false, errors: [{ code: 100117, message: "untrusted-response-marker" }] }, { status: 409 }) : undefined });
    const error = await provisionAppDomain(remote.options).catch((error) => error);
    expect(error.message).toMatch(/^\[Goribu\].*goribu check/);
    expect(error.message).not.toMatch(/private-test-credential|untrusted-response-marker/);
    expect(remote.calls.filter((call) => call.method === "PUT")).toEqual([
      { path: attachmentPath, method: "PUT", query: {}, body: { override_scope: false,
        override_existing_origin: false, override_existing_dns_record: false,
        origins: [{ hostname: appConfig.domain, zone_id: zoneId }] } },
    ]);
    expect(remote.state.domains).toEqual([]);
  });

  it("defers preview only for Cloudflare's exact missing-Worker response on a first deployment", async () => {
    const remote = cloudflare({ override: (call) => call.path === previewPath
      ? Response.json({ success: false, errors: [{ code: 10090, message: "untrusted-response-marker" }] }, { status: 404 }) : undefined });
    const plan = await inspectAppDomain(remote.options);
    expect(plan.action).toBe("connect");
    expect(plan.warnings.join(" ")).toContain("after the first Worker upload");
    expect(formatAppDomainPlan(plan)).toContain("Warning: Worker test-app does not exist yet.");
    expect(plan.warnings.join(" ")).not.toContain("untrusted-response-marker");
    expect(remote.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("fails closed on denied and unexpected missing-Worker previews", async () => {
    const responses = [
      () => failure(),
      () => Response.json({ success: false, errors: [{ code: 10007 }] }, { status: 404 }),
      () => Response.json({ success: false, errors: [{ code: 10090 }, { code: 10000 }] }, { status: 404 }),
      () => Response.json({ success: false, errors: [{ code: 10090 }] }, { status: 403 }),
    ];
    for (const response of responses) {
      const remote = cloudflare({ override: (call) => call.path === previewPath ? response() : undefined });
      const error = await inspectAppDomain(remote.options).catch((error) => error);
      expect(error.message).toMatch(/^\[Goribu\].*goribu check/);
      expect(error.message).not.toMatch(/private-test-credential|untrusted-response-marker|DNS Read/);
      expect(remote.calls.some((call) => call.method === "PUT")).toBe(false);
    }
  });

  it("rejects incomplete or unexpected changesets before attachment", async () => {
    const previews = [
      null,
      changeset({ removed: [domain({ hostname: "old.example.com" })] }),
      { added: [domain({ environment: "" })] },
      changeset({ added: [domain({ environment: "", hostname: "wrong.example.com" })] }),
      changeset({ added: [domain({ environment: "", service: "another-app" })] }),
      changeset({ added: [domain({ environment: "staging" })] }),
      changeset({ added: [domain({ environment: "", zone_id: "f".repeat(32) })] }),
      changeset({ added: [domain({ environment: "" }), domain({ environment: "" })] }),
      changeset({ updated: [domain({ environment: "", modified: false })] }),
      changeset({ added: [], updated: [domain({ environment: "", modified: "false" })] }),
      changeset({ added: [], updated: [] }),
    ];
    for (const preview of previews) {
      const remote = cloudflare({ override: (call) => call.path === previewPath ? success(preview) : undefined });
      await expect(provisionAppDomain(remote.options)).rejects.toThrow(/invalid or incomplete/);
      expect(remote.calls.some((call) => call.method === "PUT")).toBe(false);
    }
  });

  it.each(["missing", "wrong account", "inactive", "permission denied", "malformed pagination"])("blocks %s zones before attachment", async (problem) => {
    const remote = cloudflare({ override: (call) => {
      if (call.path !== "/zones") return;
      if (problem === "missing") return success([]);
      if (problem === "permission denied") return failure();
      const entry = { ...zone, name: call.query.name, ...(problem === "wrong account" && { account: { id: "f".repeat(32) } }),
        ...(problem === "inactive" && { status: "pending" }) };
      return success([entry], problem === "malformed pagination" ? { total_pages: "1" } : undefined);
    } });
    const error = await provisionAppDomain(remote.options).catch((error) => error);
    expect(error.message).toMatch(/^\[Goribu\].*goribu check/);
    expect(error.message).not.toMatch(/private-test-credential|untrusted-response-marker/);
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("follows all ownership pages and catches a conflicting owner on the last page", async () => {
    const domains = Array.from({ length: 51 }, (_, i) => domain({ id: `domain-${i}`, hostname: `host-${i}.example.com` }));
    domains[50] = domain({ service: "another-app" });
    const remote = cloudflare({ override: (call) => {
      if (call.path !== "/workers/domains") return;
      const page = Number(call.query.page), result = domains.slice((page - 1) * 50, page * 50);
      return success(result, { page, per_page: 50, count: result.length, total_pages: 2, total_count: 51 });
    } });
    await expect(provisionAppDomain(remote.options)).rejects.toThrow("already connected to Worker another-app");
    expect(remote.calls.filter((call) => call.path === "/workers/domains").map((call) => call.query.page)).toEqual(["1", "2"]);
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it.each(["duplicate", "missing page", "wrong page", "changed totals", "missing totals", "invalid ownership"])("rejects %s metadata without an attachment", async (problem) => {
    const remote = cloudflare({ override: (call) => {
      if (call.path !== "/workers/domains") return;
      if (problem === "invalid ownership") return success([domain({ environment: undefined })]);
      if (problem === "missing totals") return success([], { page: 1, per_page: 50 });
      const page = Number(call.query.page), second = page === 2;
      return success(problem === "missing page" && second ? [] : [domain({ hostname: "old.example.com", id: problem === "duplicate" ? "repeated" : `domain-${page}` })], {
        page: problem === "wrong page" ? 2 : page, per_page: 1, count: problem === "missing page" && second ? 0 : 1,
        total_pages: problem === "changed totals" && second ? 3 : 2, total_count: 2,
      });
    } });
    const error = await provisionAppDomain(remote.options).catch((error) => error);
    expect(error.message).toMatch(/\[Goribu\].*goribu check/);
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it.each(["rejected", "missing readback", "wrong readback", "invalid JSON"])("reports %s attachment without retrying or deleting anything", async (problem) => {
    let writes = 0;
    const remote = cloudflare({ override: (call) => {
      if (call.path === attachmentPath && call.method === "PUT") {
        writes++;
        if (problem === "rejected") return failure();
        if (problem === "invalid JSON") return new Response("untrusted-response-marker");
      }
      if (call.path === "/workers/domains" && call.method === "GET" && writes > 0) {
        if (problem === "missing readback") return success([]);
        if (problem === "wrong readback") return success([domain({ environment: "staging" })]);
      }
    } });
    const error = await provisionAppDomain(remote.options).catch((error) => error);
    expect(error.message).toMatch(/^\[Goribu\].*goribu check/);
    expect(error.message).not.toMatch(/private-test-credential|untrusted-response-marker/);
    expect(remote.output()).not.toContain("✓ Connected");
    expect(remote.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });

  it("rejects an unpinned account before making network calls", () => {
    const fetch = vi.fn();
    expect(() => createAppDomainManagementClient({ access: { accountId: "invalid", headers: {} }, fetch })).toThrow("CLOUDFLARE_ACCOUNT_ID");
    expect(fetch).not.toHaveBeenCalled();
  });
});
