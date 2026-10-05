import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { createR2ManagementClient } from "../src/build/cloudflare-r2.js";
import { inspectR2 } from "../src/build/inspect-r2.js";
import { provisionR2 } from "../src/build/provision-r2.js";
import { createCheckPlan, runCheck } from "../src/build/run-check.js";
import { runDeploy } from "../src/build/run-deploy.js";
import { builtAt, writeUploadBuild } from "./fixtures/r2-upload-build.js";

const access = { accountId: "a".repeat(32), headers: { Authorization: "Bearer test-credential" } };
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const config = (r2, extra = {}) => defineConfig({ name: "test-app", compatibilityDate: "2026-09-01", ...extra, ...(r2 ? { r2 } : {}) });
const success = (result) => Response.json({ success: true, result });
const failure = (status, code) => Response.json({ success: false, errors: [{ code, message: "untrusted-response-marker" }] }, { status });

// A Cloudflare management fixture. Unexpected paths/methods fail, including
// object access, deletion, and secret inspection.
function cloudflare({ bindings = null, buckets = [], override = () => undefined, enabled = true, domains = [], routes = [] } = {}) {
  const state = new Map(buckets.map((bucket) => [`${bucket.jurisdiction ?? "default"}/${bucket.name}`, bucket]));
  const calls = [];
  const fetch = async (url, init) => {
    expect(init.headers.Authorization).toBe(access.headers.Authorization);
    expect(init.redirect).toBe("error");
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://api.cloudflare.com");
    const path = parsed.pathname.startsWith("/client/v4/zones") ? parsed.pathname.slice("/client/v4".length) : parsed.pathname.split(`/accounts/${access.accountId}`)[1];
    const jurisdiction = init.headers["cf-r2-jurisdiction"];
    const call = { path, method: init.method, jurisdiction, body: init.body && JSON.parse(init.body), ...(path === "/zones" ? { query: Object.fromEntries(parsed.searchParams) } : {}) };
    calls.push(call);
    const replaced = override(call);
    if (replaced !== undefined) return replaced;
    if (path === "/zones") {
      expect(init.method).toBe("GET");
      expect(jurisdiction).toBeUndefined();
      expect(call.query["account.id"]).toBe(access.accountId);
      return success(!call.query.name || call.query.name === "example.com" ? [{ id: "b".repeat(32), name: "example.com", account: { id: access.accountId }, status: "active" }] : []);
    }
    if (parsed.pathname.endsWith(`/zones/${"b".repeat(32)}/workers/routes`)) return success(routes);
    if (path === "/workers/scripts/test-app/subdomain") return success({ enabled });
    if (path === "/workers/subdomain") return success({ subdomain: "test-account" });
    if (path === "/workers/domains") return success(domains);
    if (path === "/workers/scripts/test-app/settings" && init.method === "GET") {
      expect(jurisdiction).toBeUndefined();
      return bindings === null ? failure(404, 10007) : success({ bindings });
    }
    if (path === "/r2/buckets" && init.method === "POST") {
      const bucket = { ...call.body, jurisdiction };
      state.set(`${jurisdiction}/${bucket.name}`, bucket);
      return success(bucket);
    }
    const corsMatch = /^\/r2\/buckets\/([^/]+)\/cors$/.exec(path);
    if (corsMatch) {
      const bucket = state.get(`${jurisdiction}/${corsMatch[1]}`);
      if (!bucket) return failure(404, 10006);
      if (init.method === "PUT") { bucket.cors = call.body.rules; return success({}); }
      expect(init.method).toBe("GET");
      return bucket.cors === undefined ? failure(404, 10059) : success({ rules: bucket.cors });
    }
    const match = /^\/r2\/buckets\/([^/]+)(\/domains\/(managed|custom))?$/.exec(path);
    if (match?.[3] === "custom" && init.method === "POST") {
      state.get(`${jurisdiction}/${match[1]}`).domains ??= [];
      state.get(`${jurisdiction}/${match[1]}`).domains.push(call.body);
      return success(call.body);
    }
    if (match && init.method === "GET") {
      const bucket = state.get(`${jurisdiction}/${match[1]}`);
      if (!bucket) return failure(404, 10006);
      if (match[3] === "managed") return success({ enabled: bucket.devUrlEnabled ?? false, domain: "pub-test.r2.dev" });
      if (match[3] === "custom") return success({ domains: bucket.domains ?? [] });
      return success({ name: bucket.name, jurisdiction: bucket.jurisdiction ?? "default" });
    }
    throw new Error(`Unexpected Cloudflare operation: ${init.method} ${path}`);
  };
  return { fetch, calls, state };
}

function setup(appConfig, remote) {
  const projectRoot = mkdtempSync(join(tmpdir(), "goribu-r2-plan-"));
  roots.push(projectRoot);
  writeUploadBuild(projectRoot, appConfig);
  let output = "";
  const options = { projectRoot, appConfig, getAccess: async () => access, fetch: remote.fetch, listSecrets: async () => [],
    stdout: { write(text) { output += text; } } };
  return { options, output: () => output,
    check: () => runCheck({ ...options, loadConfig: async () => appConfig,
      inspectR2: (input) => inspectR2({ ...options, ...input }) }) };
}

describe("R2 bucket planning and provisioning", () => {
  it.each([undefined, "eu"])("checks without writes, creates two buckets once, and reuses them (%s jurisdiction)", async (jurisdiction) => {
    const appConfig = config({ name: "app-media", domain: "media.example.com", private: { name: "app-files" }, ...(jurisdiction && { jurisdiction }) });
    const remote = cloudflare();
    const { options, check, output } = setup(appConfig, remote);
    const plan = await check();
    expect(plan.resources).toMatchObject([
      { kind: "R2 bucket", name: "app-media", action: "create" },
      { kind: "R2 bucket", name: "app-files", action: "create" },
    ]);
    expect(plan.bindings.map((binding) => binding.name)).toEqual(["R2", "R2_PRIVATE"]);
    expect(output()).toContain(`create bucket  app-files (${jurisdiction ?? "default"}) -> R2_PRIVATE`);
    expect(output()).toContain("No changes were made.");
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
    expect(remote.state.size).toBe(0);

    const provisionPlan = await provisionR2(options);
    expect(provisionPlan).toEqual(plan.r2);
    const writes = remote.calls.filter((call) => call.method !== "GET");
    expect(writes.filter((call) => call.path === "/r2/buckets")).toEqual(["app-media", "app-files"].map((name) => ({
      path: "/r2/buckets", method: "POST", jurisdiction: jurisdiction ?? "default", body: { name },
    })));
    expect(writes.at(-1)).toMatchObject({ path: "/r2/buckets/app-media/domains/custom", method: "POST", body: { domain: "media.example.com", enabled: true, zoneId: "b".repeat(32), minTLS: "1.2" } });
    expect(remote.calls.filter((call) => call.path.startsWith("/r2/")).every((call) => call.jurisdiction === (jurisdiction ?? "default"))).toBe(true);
    const beforeRepeat = remote.calls.length;
    const reused = await provisionR2(options);
    expect(reused.buckets.every((bucket) => bucket.state === "existing")).toBe(true);
    expect(remote.calls.slice(beforeRepeat).every((call) => call.method === "GET")).toBe(true);
  });

  it.each([
    ["old-files", undefined, "app-files", undefined],
    ["app-files", undefined, "app-files", "eu"],
    ["app-files", "eu", "app-files", undefined],
  ])("warns about a deployed binding changing from %s/%s to %s/%s", async (oldName, oldJurisdiction, name, jurisdiction) => {
    const remote = cloudflare({ bindings: [{ type: "r2_bucket", name: "R2", bucket_name: oldName, ...(oldJurisdiction && { jurisdiction: oldJurisdiction }) }] });
    const { check, output } = setup(config({ name, ...(jurisdiction && { jurisdiction }) }), remote);
    await check();
    expect(output()).toContain(`R2 changes from ${oldName} (${oldJurisdiction ?? "default"}) to ${name} (${jurisdiction ?? "default"})`);
    expect(output()).toContain("A new empty bucket will be created.");
    expect(output()).toContain("Existing stored keys still refer to the old bucket's objects.");
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("warns about extra domains on public buckets and removed private bindings without disconnecting or deleting them", async () => {
    const remote = cloudflare({ bindings: [{ name: "R2_PRIVATE", type: "r2_bucket", bucket_name: "old-private", jurisdiction: "eu" }],
      buckets: [{ name: "app-files", jurisdiction: "eu", domains: [
        { domain: "media.example.com", enabled: true }, { domain: "off.example.com", enabled: false },
      ] }] });
    const { options, output } = setup(config({ name: "app-files", domain: "new.example.com", jurisdiction: "eu" }), remote);
    await provisionR2(options);
    expect(output()).toContain("Bucket app-files remains public at media.example.com");
    expect(output()).toContain("`pnpm exec goribu wrangler r2 bucket domain remove app-files --domain media.example.com -J eu`");
    expect(output()).toContain("R2_PRIVATE is removed from the Worker; bucket old-private (eu) and all its objects remain unchanged.");
    expect(output()).not.toContain("off.example.com");
    expect(remote.calls.filter((call) => call.method !== "GET")).toMatchObject([{ method: "POST", path: "/r2/buckets/app-files/domains/custom", body: { domain: "new.example.com" } }]);
  });

  it.each([
    [false, "r2.dev"], [true, "r2.dev"],
    [false, "custom domain"], [true, "custom domain"],
  ])("blocks private exposure in check and before ANY deployment mutation (second bucket: %s, via %s)", async (second, exposure) => {
    const appConfig = config({ name: second ? "app-media" : "app-files", jurisdiction: "eu",
      ...(second && { domain: "media.example.com", private: { name: "app-files" } }) });
    const custom = exposure === "custom domain";
    const remote = cloudflare({ buckets: [{ name: "app-files", jurisdiction: "eu",
      ...(custom ? { domains: [{ domain: "media.example.com", enabled: true }] } : { devUrlEnabled: true }) }] });
    const { options, check, output } = setup(appConfig, remote);
    // A blocked check is a plan result that states each reason once, not a thrown failure.
    const repair = custom
      ? "`pnpm exec goribu wrangler r2 bucket domain remove app-files --domain media.example.com -J eu`"
      : "`pnpm exec goribu wrangler r2 bucket dev-url disable app-files -J eu`";
    expect((await check()).r2.errors.join(" ")).toContain(repair);
    expect(output().split(repair)).toHaveLength(2);
    expect(output()).toContain("Blocked: Private bucket app-files (eu) has public");
    expect(output()).toContain("Blocked: `goribu deploy` will not proceed until the Blocked items above are resolved.");
    expect(output()).toContain("No changes were made.");
    const later = { provision: vi.fn(), provisionKV: vi.fn(), migrate: vi.fn(), deploy: vi.fn() };
    await expect(runDeploy({ ...options, ...later, loadConfig: async () => appConfig,
      build: async () => {}, finalizeR2Account() {},
      provisionR2: (input) => provisionR2({ ...input, fetch: remote.fetch }),
    })).rejects.toThrow("[Goribu] R2 cannot proceed. Resolve the Blocked items above, then rerun `goribu deploy`.");
    for (const fn of Object.values(later)) expect(fn).not.toHaveBeenCalled();
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
    // Even a missing first bucket must not be created before inspecting the second.
    expect(remote.state.has("eu/app-media")).toBe(false);
  });

  it("permits r2.dev on a declared public bucket and leaves its access settings untouched", async () => {
    const remote = cloudflare({ buckets: [{ name: "app-media", devUrlEnabled: true,
      domains: [{ domain: "media.example.com", enabled: true }] }] });
    const { options } = setup(config({ name: "app-media", domain: "media.example.com" }), remote);
    const plan = await provisionR2(options);
    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it.each([
    ["unknown missing Worker", "/workers/scripts/test-app/settings", () => failure(404, 99999)],
    ["permission denied", "/r2/buckets/app-files", () => failure(403, 10000)],
    ["unknown missing bucket", "/r2/buckets/app-files", () => failure(404, 99999)],
    ["invalid JSON", "/r2/buckets/app-files", () => new Response("not-json")],
    ["wrong bucket", "/r2/buckets/app-files", () => success({ name: "someone-elses-files" })],
    ["wrong jurisdiction", "/r2/buckets/app-files", () => success({ name: "app-files", jurisdiction: "eu" })],
    ["unknown public access", "/r2/buckets/app-files/domains/managed", () => success({})],
    ["unknown custom domains", "/r2/buckets/app-files/domains/custom", () => success({ domains: null })],
  ])("fails closed on %s without exposing remote error text", async (_label, path, response) => {
    const remote = cloudflare({ buckets: [{ name: "app-files" }], override: (call) => call.path === path ? response() : undefined });
    const { options, output } = setup(config({ name: "app-files" }), remote);
    const error = await provisionR2(options).catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/^\[Goribu\].*goribu check/);
    expect(`${error.message}${output()}`).not.toMatch(/untrusted-response-marker|test-credential/);
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("stops on partial creation failure and preserves the bucket already created", async () => {
    const remote = cloudflare({ override: (call) => call.method === "POST" && call.body.name === "app-files" ? failure(409, 10073) : undefined });
    const { options } = setup(config({ name: "app-media", domain: "media.example.com", private: { name: "app-files" } }), remote);
    await expect(provisionR2(options)).rejects.toThrow(/HTTP 409/);
    expect([...remote.state.keys()]).toEqual(["default/app-media"]);
    expect(remote.calls.filter((call) => call.method !== "GET").map((call) => call.method)).toEqual(["POST", "POST"]);
  });

  it.each(["r2.dev", "custom domain"])("rechecks public access after creation and refuses an unexpectedly public private bucket via %s", async (exposure) => {
    const remote = cloudflare({ override: (call) => {
      if (exposure === "r2.dev" && call.path.endsWith("/domains/managed")) return success({ enabled: true });
      if (exposure === "custom domain" && call.path.endsWith("/domains/custom")) return success({ domains: [{ domain: "media.example.com", enabled: true }] });
    } });
    const { options } = setup(config({ name: "app-files" }), remote);
    await expect(provisionR2(options)).rejects.toThrow(/Private bucket app-files \(default\) has public/);
    expect(remote.state.has("default/app-files")).toBe(true);
    expect(remote.calls.filter((call) => call.method !== "GET").map((call) => call.method)).toEqual(["POST"]);
  });

  it("allows disabled custom domains on private buckets", async () => {
    const remote = cloudflare({ buckets: [{ name: "app-files", domains: [{ domain: "off.example.com", enabled: false }] }] });
    const { options } = setup(config({ name: "app-files" }), remote);
    const plan = await provisionR2(options);
    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it.each([["R2", "secret_text"], ["R2_PRIVATE", "secret_key"]])("provides an executable repair for a retained %s secret without exposing its value", async (name, type) => {
    const remote = cloudflare({ bindings: [{ name, type, text: "binding-value-must-not-appear" }] });
    const { options, output } = setup(config({ name: "app-files" }), remote);
    const error = await provisionR2(options).catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(`The deployed Worker has a ${type} binding named ${name}`);
    expect(error.message).toContain(`Remove or rename ${name} in .env.production if present`);
    expect(error.message).toContain(`\`pnpm exec goribu wrangler secret delete ${name} --name test-app\``);
    expect(error.message).not.toContain("-J");
    expect(`${error.message}${output()}`).not.toMatch(/binding-value-must-not-appear|Update Goribu/);
    expect(remote.calls).toHaveLength(1);
    expect(remote.calls[0].method).toBe("GET");
  });

  it.each([["R2", "plain_text"], ["R2_PRIVATE", "kv_namespace"]])("warns when deploy replaces a non-secret %s binding and still provisions", async (name, type) => {
    const remote = cloudflare({ bindings: [{ name, type, text: "binding-value-must-not-appear" }] });
    const { options, check, output } = setup(config({ name: "app-media", domain: "media.example.com", private: { name: "app-files" } }), remote);
    const plan = await check();
    expect(plan.r2.warnings).toContainEqual(expect.stringContaining(`Deploy replaces the existing ${type} binding named ${name} with the managed R2 bucket`));
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
    await provisionR2(options);
    expect(remote.state.size).toBe(2);
    expect(output()).not.toMatch(/binding-value-must-not-appear|undefined|old bucket/);
  });

  it("reports removal of a non-secret R2_PRIVATE binding when no private bucket is declared", async () => {
    const remote = cloudflare({ bindings: [{ name: "R2_PRIVATE", type: "plain_text" }] });
    const { check, output } = setup(config({ name: "app-files" }), remote);
    await check();
    expect(output()).toContain("Deploy removes the existing plain_text binding named R2_PRIVATE");
    expect(output()).not.toMatch(/undefined|objects remain/);
  });

  it("reads only R2 binding metadata, ignoring secret and variable values", async () => {
    const forbidden = () => { throw new Error("Secret values must never be read"); };
    const client = createR2ManagementClient({ access, fetch: async () => ({ ok: true, status: 200, json: async () => ({ success: true, result: { bindings: [
      { name: "GORIBU_SECRET", type: "secret_text", get text() { return forbidden(); } },
      { name: "APP_VARIABLE", type: "plain_text", get text() { return forbidden(); } },
      { name: "R2", type: "r2_bucket", bucket_name: "app-files" },
    ] } }) }) });
    await expect(client.worker("test-app")).resolves.toEqual({ exists: true, bindings: [{ binding: "R2", type: "r2_bucket", name: "app-files", jurisdiction: "default" }] });
  });

  it("rejects ambiguous managed binding metadata", async () => {
    const binding = { name: "R2", type: "r2_bucket", bucket_name: "app-files" };
    const remote = cloudflare({ bindings: [binding, binding] });
    const { options } = setup(config({ name: "app-files" }), remote);
    await expect(provisionR2(options)).rejects.toThrow(/invalid managed Worker R2 bindings/);
    expect(remote.calls).toHaveLength(1);
  });

  it("does no R2 work without a declaration, but refuses a declared R2 plan without inspection", async () => {
    const getAccess = vi.fn();
    const options = { projectRoot: "/app", appConfig: config(), getAccess };
    await expect(inspectR2(options)).resolves.toBeNull();
    await expect(provisionR2(options)).resolves.toBeNull();
    expect(getAccess).not.toHaveBeenCalled();
    expect(() => createCheckPlan({ appConfig: config({ name: "app-files" }) })).toThrow(/R2 deployment plan is missing/);
  });

  it("selects the most specific zone in the authenticated account", async () => {
    const remote = cloudflare({ override: (call) => call.path === "/zones" ? success([
      { name: "media.example.com", id: "c".repeat(32), account: { id: access.accountId }, status: "active" },
    ]) : undefined });
    const { options, check, output } = setup(config({ name: "app-media", domain: "media.example.com", jurisdiction: "eu" }), remote);
    const plan = await check();
    expect(plan.r2.domain).toMatchObject({ action: "connect", zoneId: "c".repeat(32), jurisdiction: "eu" });
    expect(output()).toContain("connect domain  media.example.com -> app-media (eu)");
    expect(remote.calls.filter((call) => call.path === "/zones")).toHaveLength(1);
    await provisionR2(options);
    expect(remote.calls.find((call) => call.method === "POST" && call.path.endsWith("/domains/custom"))).toMatchObject({ jurisdiction: "eu", body: { zoneId: "c".repeat(32) } });
  });

  it.each(["missing", "other account", "inactive", "incomplete", "permission denied"])("rejects %s zone lookup before resource writes", async (problem) => {
    const zone = { name: "media.example.com", id: "b".repeat(32), account: { id: problem === "other account" ? "c".repeat(32) : access.accountId }, status: problem === "inactive" ? "pending" : "active" };
    const remote = cloudflare({ override: (call) => {
      if (call.path !== "/zones") return;
      if (problem === "missing") return success([]);
      if (problem === "permission denied") return failure(403, 10000);
      if (problem === "incomplete") return Response.json({ success: true, result: [zone], result_info: { total_pages: 2, total_count: 2 } });
      return success([zone]);
    } });
    const { options, check } = setup(config({ name: "app-media", domain: "media.example.com" }), remote);
    await expect(check()).rejects.toThrow(/\[Goribu\].*zone|\[Goribu\].*Cloudflare rejected/);
    await expect(provisionR2(options)).rejects.toThrow(/\[Goribu\]/);
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("refuses a disabled configured domain without overwriting its settings", async () => {
    const remote = cloudflare({ buckets: [{ name: "app-media", domains: [{ domain: "media.example.com", enabled: false }] }] });
    const { options } = setup(config({ name: "app-media", domain: "media.example.com" }), remote);
    await expect(provisionR2(options)).rejects.toThrow(/connected but disabled.*Enable it in Cloudflare/);
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("preserves created buckets when domain attachment conflicts", async () => {
    const remote = cloudflare({ override: (call) => call.method === "POST" && call.path.endsWith("/domains/custom") ? failure(409, 10000) : undefined });
    const { options } = setup(config({ name: "app-media", domain: "media.example.com" }), remote);
    await expect(provisionR2(options)).rejects.toThrow(/HTTP 409/);
    expect(remote.state.size).toBe(1);
    expect(remote.calls.every((call) => ["GET", "POST"].includes(call.method))).toBe(true);
  });

  it("plans secrets by platform names, skips list for a missing Worker, and fails closed on list errors", async () => {
    const remote = cloudflare({ bindings: [] });
    const { options } = setup(config({ name: "app-files" }), remote);
    const listSecrets = vi.fn(async () => ["GORIBU_SECRET", "R2_ACCESS_KEY_ID"]);
    expect((await inspectR2({ ...options, listSecrets })).signingSecret).toBe("existing");
    expect(listSecrets.mock.calls[0][0].access).toBe(access);
    await expect(provisionR2({ ...options, listSecrets: async () => { throw new Error("list failed"); } })).rejects.toThrow("list failed");
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
    listSecrets.mockClear();
    expect((await inspectR2({ ...options, fetch: cloudflare().fetch, listSecrets })).signingSecret).toBe("missing");
    expect(listSecrets).not.toHaveBeenCalled();
  });

  it("keeps check build-free when metadata is missing while deploy requires fresh metadata", async () => {
    const remote = cloudflare();
    const { options, check, output } = setup(config({ name: "app-files" }), remote);
    rmSync(join(options.projectRoot, "output/r2-uploads.json"));
    const plan = await check();
    expect(plan.r2.buckets[0].state).toBe("missing");
    expect(plan.r2.signingSecret).toBe("missing");
    expect(output()).toContain("CORS and R2 key checks skipped: run goribu build first");
    expect(output()).toContain("create secret    GORIBU_SECRET");
    await expect(provisionR2(options)).rejects.toThrow("Run `goribu build` first");
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
    rmSync(join(options.projectRoot, ".wrangler"), { recursive: true });
    await expect(check()).resolves.toMatchObject({ r2: { uploads: { builtAt: null } } });
  });

  it("uses the last build for check, provisions only direct buckets, and retains unrelated rules", async () => {
    const otherRule = { id: "public-read", allowed: { origins: ["https://reader.example.com"], methods: ["GET"] } };
    const remote = cloudflare({ bindings: [], buckets: [{ name: "app-files", jurisdiction: "eu", cors: [otherRule] }],
      domains: [{ service: "test-app", environment: "production", hostname: "app.example.com" }],
      routes: [{ script: "test-app", pattern: "https://form.example.com/upload*" }, { script: "test-app", pattern: "*.example.com/*" }] });
    const appConfig = config({ name: "app-media", domain: "media.example.com", private: { name: "app-files" }, jurisdiction: "eu" });
    const { options, check, output } = setup(appConfig, remote);
    options.listSecrets = async () => ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "GORIBU_SECRET"];
    const fields = { file: { accept: ["application/pdf"], maxBytes: 200_000_000, private: true, direct: true },
      publicFile: { accept: ["image/svg+xml"], maxBytes: 100, private: false, direct: false } };
    writeUploadBuild(options.projectRoot, appConfig, fields);
    // Check must not evaluate source code or app-authored env files.
    writeFileSync(join(options.projectRoot, ".env.production"), "R2_SECRET_ACCESS_KEY=never-read-test-value");
    const plan = await check();
    expect(output()).toContain(`Upload policies from build ${builtAt}`);
    expect(output()).toContain("source edits since that build are not inspected");
    expect(output()).toContain("Skipped wildcard-host Worker route");
    expect(output()).toContain("accepts active HTML or SVG");
    expect(output()).not.toContain("never-read-test-value");
    expect(plan.r2.uploads.cors).toEqual([{ bucket: "app-files", jurisdiction: "eu", action: "upsert", origins: [
      "https://app.example.com", "https://form.example.com", "https://test-app.test-account.workers.dev",
    ] }]);
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
    await provisionR2(options);
    expect(remote.state.get("eu/app-files").cors[0]).toEqual(otherRule);
    expect(remote.state.get("eu/app-files").cors[1].allowed.headers).toEqual(["content-type", "cache-control", "if-none-match", "x-amz-meta-goribu-upload"]);
    expect(remote.calls.filter((call) => call.path.endsWith("/cors")).every((call) => call.path.includes("app-files") && call.jurisdiction === "eu")).toBe(true);
    const start = remote.calls.length;
    await provisionR2(options);
    expect(remote.calls.slice(start).every((call) => call.method === "GET")).toBe(true);
    writeUploadBuild(options.projectRoot, appConfig, { file: { ...fields.file, maxBytes: 10, direct: false } });
    const before = structuredClone(remote.state.get("eu/app-files").cors);
    const after = remote.calls.length;
    options.listSecrets = async () => [];
    await provisionR2(options);
    expect(remote.state.get("eu/app-files").cors).toEqual(before);
    expect(remote.calls.slice(after).some((call) => call.path.endsWith("/cors") || call.path.endsWith("/subdomain"))).toBe(false);
  });

  it("includes a planned app domain in upload CORS before attachment and requires its verified account", async () => {
    const remote = cloudflare({ bindings: [], domains: [
      { service: "test-app", environment: "production", hostname: "old.example.com" },
    ] });
    const appConfig = config({ name: "app-files" }, { domain: "new.example.com" });
    const { options, check, output } = setup(appConfig, remote);
    const appDomain = { name: appConfig.domain, worker: appConfig.name, accountId: access.accountId,
      zoneId: "b".repeat(32), action: "connect", otherDomains: [], warnings: [] };
    options.inspectAppDomain = async () => appDomain;
    options.listSecrets = async () => ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
    writeUploadBuild(options.projectRoot, appConfig, { file: { accept: ["application/pdf"], maxBytes: 10, private: false, direct: true } });
    const plan = await check();
    const origins = ["https://new.example.com", "https://old.example.com", "https://test-app.test-account.workers.dev"];
    expect(plan.r2.uploads.cors[0]).toMatchObject({ origins, connectedByDeploy: "https://new.example.com" });
    expect(output()).toContain("https://new.example.com (connected by this deploy)");
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);

    for (const unchecked of [undefined, { ...appDomain, accountId: "c".repeat(32) }]) {
      await expect(provisionR2({ ...options, appDomain: unchecked })).rejects.toThrow("application domain has not been inspected");
    }
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
    await provisionR2({ ...options, appDomain: plan.appDomain });
    expect(remote.state.get("default/app-files").cors[0].allowed.origins).toEqual(origins);

    // An already attached domain also appears in discovery. Keep one origin.
    const connected = cloudflare({ bindings: [], domains: [
      { service: "test-app", environment: "production", hostname: "new.example.com" },
    ] });
    const repeat = await inspectR2({ ...options, fetch: connected.fetch, appDomain: { ...appDomain, action: "none" } });
    expect(repeat.uploads.cors[0].origins).toEqual(["https://new.example.com", "https://test-app.test-account.workers.dev"]);
    expect(repeat.uploads.cors[0].connectedByDeploy).toBeUndefined();

    // Disabling workers.dev drops its origin from the managed rule on the next deploy.
    const domainOnly = config({ name: "app-files" }, { domain: "new.example.com", workersDev: false });
    await provisionR2({ ...options, appConfig: domainOnly, appDomain: plan.appDomain });
    expect(remote.state.get("default/app-files").cors[0].allowed.origins).toEqual(["https://new.example.com", "https://old.example.com"]);
  });

  it.each(["keys", "origins", "first deploy"])("stops direct uploads before any provisioning write when missing %s", async (reason) => {
    const remote = cloudflare({ bindings: reason === "first deploy" ? null : [], enabled: false,
      override: (call) => reason === "origins" && call.path === "/workers/subdomain" ? failure(404, 10007) : undefined,
      routes: reason === "keys" ? [{ script: "test-app", pattern: "app.example.com/*" }] : [{ script: "test-app", pattern: "*.example.com/*" }] });
    const appConfig = config({ name: "app-files", jurisdiction: "eu" });
    const { options, check, output } = setup(appConfig, remote);
    options.listSecrets = vi.fn(async () => reason === "keys" ? ["R2_ACCESS_KEY_ID"] : ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]);
    writeUploadBuild(options.projectRoot, appConfig, { file: { accept: ["application/pdf"], maxBytes: 10, private: false, direct: true } });
    writeFileSync(join(options.projectRoot, ".env.production"), "R2_ACCESS_KEY_ID=test-only\nR2_SECRET_ACCESS_KEY=not-a-real-secret\n");
    if (reason === "origins") await expect(check()).rejects.toThrow("account has no workers.dev subdomain");
    else {
      // Missing keys are a deploy step, so check reports them without blocking.
      const plan = await check();
      expect(plan.r2.errors).toEqual([]);
      expect(plan.r2.uploads.missingKeys).toEqual(reason === "keys" ? ["R2_SECRET_ACCESS_KEY"] : ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]);
    }
    const later = { provision: vi.fn(), provisionKV: vi.fn(), migrate: vi.fn(), deploy: vi.fn(), ensureR2SigningSecret: vi.fn() };
    await expect(runDeploy({ ...options, ...later, loadConfig: async () => appConfig, build: async () => {},
      finalizeR2Account() {}, validateSecrets() {}, canPrompt: false,
      provisionR2: (input) => provisionR2({ ...input, fetch: remote.fetch, listSecrets: options.listSecrets }),
    })).rejects.toThrow(reason === "origins" ? "account has no workers.dev subdomain" : "goribu deploy can only ask for them in a terminal");
    Object.values(later).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
    if (reason === "first deploy") {
      expect(options.listSecrets).not.toHaveBeenCalled();
      expect(output()).toContain("https://test-app.test-account.workers.dev (expected after first deploy)");
      expect(output()).not.toContain("no discoverable application origin");
      // Secret setup can create a disabled draft. Wrangler will enable its
      // address on this deploy, so the plan must include it and allow CORS.
      const draft = cloudflare({ bindings: [], enabled: false });
      await expect(provisionR2({ ...options, fetch: draft.fetch })).resolves.toMatchObject({ uploads: {
        keys: "existing", cors: [{ origins: ["https://test-app.test-account.workers.dev"], enabledByDeploy: "https://test-app.test-account.workers.dev" }],
      } });
      expect(output()).toContain("https://test-app.test-account.workers.dev (enabled by this deploy)");
      expect(draft.calls.some((call) => call.method === "PUT" && call.path.endsWith("/cors"))).toBe(true);
    }
    if (reason === "keys") {
      expect(output()).toContain("R2 upload keys: missing R2_SECRET_ACCESS_KEY. goribu deploy creates the upload buckets, then asks for the keys");
      expect(output()).not.toContain("Blocked:");
      expect(output()).not.toContain("not-a-real-secret");
      // With a terminal, provisioning goes ahead so the token can be scoped
      // to the new bucket; deploy asks for the key before the Worker upload.
      await expect(provisionR2({ ...options, canPrompt: true })).resolves.toMatchObject({ uploads: { keys: "missing" } });
      expect(remote.state.has("eu/app-files")).toBe(true);
    }
  });
});
