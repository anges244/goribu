import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { createR2ManagementClient } from "../src/build/cloudflare-r2.js";
import { inspectR2 } from "../src/build/inspect-r2.js";
import { provisionR2 } from "../src/build/provision-r2.js";
import { createCheckPlan, runCheck } from "../src/build/run-check.js";
import { runDeploy } from "../src/build/run-deploy.js";

const access = { accountId: "a".repeat(32), headers: { Authorization: "Bearer test-credential" } };
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const config = (r2, extra = {}) => defineConfig({ name: "test-app", compatibilityDate: "2026-09-01", ...extra, ...(r2 ? { r2 } : {}) });
const success = (result) => Response.json({ success: true, result });
const failure = (status, code) => Response.json({ success: false, errors: [{ code, message: "untrusted-response-marker" }] }, { status });

// A metadata-only Cloudflare fixture. Unexpected paths/methods fail, including
// object access, deletion, public-access changes, and secret inspection.
function cloudflare({ bindings = null, buckets = [], override = () => undefined } = {}) {
  const state = new Map(buckets.map((bucket) => [`${bucket.jurisdiction ?? "default"}/${bucket.name}`, bucket]));
  const calls = [];
  const fetch = async (url, init) => {
    expect(url).toMatch(new RegExp(`^https://api.cloudflare.com/client/v4/accounts/${access.accountId}/`));
    expect(init.headers.Authorization).toBe(access.headers.Authorization);
    expect(init.redirect).toBe("error");
    const path = new URL(url).pathname.split(`/accounts/${access.accountId}`)[1];
    const jurisdiction = init.headers["cf-r2-jurisdiction"];
    const call = { path, method: init.method, jurisdiction, body: init.body && JSON.parse(init.body) };
    calls.push(call);
    const replaced = override(call);
    if (replaced !== undefined) return replaced;
    if (path === "/workers/scripts/test-app/settings" && init.method === "GET") {
      expect(jurisdiction).toBeUndefined();
      return bindings === null ? failure(404, 10007) : success({ bindings });
    }
    if (path === "/r2/buckets" && init.method === "POST") {
      const bucket = { ...call.body, jurisdiction };
      state.set(`${jurisdiction}/${bucket.name}`, bucket);
      return success(bucket);
    }
    const match = /^\/r2\/buckets\/([^/]+)(\/domains\/(managed|custom))?$/.exec(path);
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
  let output = "";
  const options = { projectRoot, appConfig, getAccess: async () => access, fetch: remote.fetch,
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
    expect(writes).toEqual(["app-media", "app-files"].map((name) => ({
      path: "/r2/buckets", method: "POST", jurisdiction: jurisdiction ?? "default", body: { name },
    })));
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
    expect(output()).toContain("wrangler r2 bucket domain remove app-files --domain media.example.com -J eu");
    expect(output()).toContain("R2_PRIVATE is removed from the Worker; bucket old-private (eu) and all its objects remain unchanged.");
    expect(output()).not.toContain("off.example.com");
    expect(remote.calls.every((call) => call.method === "GET")).toBe(true);
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
    await expect(check()).rejects.toThrow(custom
      ? "wrangler r2 bucket domain remove app-files --domain media.example.com -J eu"
      : "wrangler r2 bucket dev-url disable app-files -J eu");
    expect(output()).toContain("Blocked: Private bucket app-files (eu) has public");
    expect(output()).toContain("No changes were made.");
    const later = { provision: vi.fn(), provisionKV: vi.fn(), migrate: vi.fn(), deploy: vi.fn() };
    await expect(runDeploy({ ...options, ...later, loadConfig: async () => appConfig,
      build: async () => {}, finalizeR2Account() {},
      provisionR2: (input) => provisionR2({ ...input, fetch: remote.fetch }),
    })).rejects.toThrow("[Goribu] R2 cannot proceed.");
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
    expect(error.message).toContain(`CLOUDFLARE_ACCOUNT_ID=${access.accountId} wrangler secret delete ${name} --name test-app`);
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
    await expect(client.deployedBindings("test-app")).resolves.toEqual([{ binding: "R2", type: "r2_bucket", name: "app-files", jurisdiction: "default" }]);
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
});
