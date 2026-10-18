import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { writeWranglerConfig } from "../src/build/generate-wrangler-config.js";
import { readWranglerSchema } from "../src/build/resolve-wrangler-bin.js";
import { compileWranglerSchema } from "../src/build/wrangler-schema.js";
import { prepareDevelopmentRemoteBindings } from "../src/build/development-remote-bindings.js";
import { createCheckPlan, formatCheckPlan } from "../src/build/run-check.js";

const created = [];
const base = { name: "passthrough-app", compatibilityDate: "2026-08-31" };

function write(wrangler, extra = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), "goribu-passthrough-"));
  created.push(projectRoot);
  return writeWranglerConfig({ projectRoot, appConfig: defineConfig({ ...base, ...extra, wrangler }) });
}

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

// Cloudflare's documented shapes for the bindings and settings the block opens up.
const documented = {
  ai: { binding: "AI" },
  services: [{ binding: "SEARCH", service: "search-worker", entrypoint: "SearchEntrypoint" }],
  vectorize: [{ binding: "VECTORIZE", index_name: "example-index" }],
  queues: { producers: [{ binding: "MY_QUEUE", queue: "example-queue" }] },
  analytics_engine_datasets: [{ binding: "WEATHER", dataset: "weather_data" }],
  browser: { binding: "BROWSER" },
  durable_objects: { bindings: [{ name: "COUNTER", class_name: "Counter", script_name: "counter-worker" }] },
  workflows: [{ binding: "MY_WORKFLOW", name: "workflows-starter", class_name: "MyWorkflow", script_name: "workflows-starter" }],
  vars: { API_HOST: "example.com", SERVICE_X_DATA: { URL: "service-x-api.dev.example", MY_ID: 123 } },
  observability: { enabled: true, head_sampling_rate: 0.1 },
  limits: { cpu_ms: 100, subrequests: 150 },
};

describe("wrangler passthrough", () => {
  it("writes documented native fields after Goribu's own, from a deeply frozen JSON snapshot", () => {
    const { outputFile, config } = write(documented, { kv: { name: "passthrough-kv" } });
    const written = JSON.parse(readFileSync(outputFile, "utf8").replace(/^\/\/[^\n]*\n/, ""));
    expect(written).toEqual(config);
    expect(written).toMatchObject({ ...documented, name: "passthrough-app", kv_namespaces: [{ binding: "KV", preview_id: "passthrough-kv" }] });

    const appConfig = defineConfig({ ...base, wrangler: documented });
    expect(Object.isFrozen(appConfig.wrangler.services[0])).toBe(true);
    expect(Object.isFrozen(appConfig.wrangler.vars.SERVICE_X_DATA)).toBe(true);
  });

  it.each([
    ["undefined", { vars: { A: undefined } }, "wrangler.vars.A is undefined"],
    ["a function", { vars: { A() {} } }, "wrangler.vars.A is a function"],
    ["a non-finite number", { limits: { cpu_ms: Infinity } }, "wrangler.limits.cpu_ms is Infinity"],
    ["a non-plain object", { vars: { A: new Date(0) } }, "wrangler.vars.A is not a plain object or array"],
    ["a sparse array", { services: [{ binding: "A", service: "a" }, , { binding: "B", service: "b" }] }, "wrangler.services[1] is a hole"], // eslint-disable-line no-sparse-arrays
    ["a cycle", (() => { const vars = {}; vars.self = vars; return { vars }; })(), "wrangler.vars.self refers back"],
    ["a getter", { get vars() { return {}; } }, "wrangler.vars must be an ordinary enumerable value"],
  ])("rejects %s, which JSON would not round-trip", (_label, wrangler, message) => {
    expect(() => defineConfig({ ...base, wrangler })).toThrow(message);
  });

  it("reports a reserved field as Goribu's before any schema check, and reserves framework names unconditionally", () => {
    // Not even a valid kv_namespaces shape: the reserved check still answers first.
    expect(() => write({ kv_namespaces: "nope" })).toThrow(
      "[Goribu] wrangler.kv_namespaces cannot be set in goribu.config.js: Goribu manages the KV binding; declare kv in goribu.config.js.",
    );
    expect(() => write({ unsafe: {} })).toThrow("wrangler.unsafe cannot be set");
    expect(() => write({ queues: { consumers: [{ queue: "q" }] } })).toThrow("wrangler.queues.consumers cannot be set");
    expect(() => write({ durable_objects: { bindings: [{ name: "C", class_name: "C" }] } })).toThrow(
      "wrangler.durable_objects.bindings[0] binds a Durable Object class from this Worker",
    );
    expect(() => write({ workflows: [{ binding: "W", name: "w", class_name: "W", script_name: "passthrough-app" }] })).toThrow(
      "wrangler.workflows[0] binds a Workflow class from this Worker",
    );
    // The app declares no database, yet DB stays reserved.
    expect(() => write({ services: [{ binding: "DB", service: "db-worker" }] })).toThrow(
      'The wrangler service binding name "DB" is reserved for Goribu, whether or not the matching feature is enabled.',
    );
    expect(() => write({ vars: { GORIBU_SECRET: "x" } })).toThrow('The wrangler var name "GORIBU_SECRET" is reserved');
  });

  it("names unknown fields anywhere in the config, before the missing field a typo causes", () => {
    expect(() => write({ obserability: { enabled: true } })).toThrow(
      '[Goribu] wrangler contains unknown field "obserability". Check its spelling against Wrangler\'s configuration reference. This Goribu installation uses Wrangler 4.127.1; if the field needs a newer Wrangler, update goribu.',
    );
    expect(() => write({ observability: { enabled: true, head_samplng_rate: 0.1 } })).toThrow(
      'wrangler.observability contains unknown field "head_samplng_rate"',
    );
    expect(() => write({ services: [{ binding: "SEARCH", servce: "search-worker" }] })).toThrow(
      /^\[Goribu\] wrangler\.services\[0\] contains unknown field "servce".*\n\[Goribu\] wrangler\.services\[0\] is missing required field "service"\.$/,
    );
    expect(() => write({ observability: { enabled: "yes" } })).toThrow("[Goribu] wrangler.observability.enabled must be boolean.");
  });

  it("passes what the schema cannot express to Wrangler's own reader", () => {
    expect(() => write({ services: [{ binding: "SEARCH", service: "search-worker" }], vars: { SEARCH: "x" } })).toThrow(
      /^\[Goribu\] Wrangler rejected the config generated from the wrangler block in goribu\.config\.js:\n[\s\S]*SEARCH[\s\S]*\nFix the wrangler block in goribu\.config\.js\.$/,
    );
  });

  it("refuses a schema keyword it cannot enforce, and keeps the declared reserved fields in sync", () => {
    const { version, schema } = readWranglerSchema();
    const changed = structuredClone(schema);
    changed.definitions.Observability.properties.head_sampling_rate.maximum = 1;
    expect(() => compileWranglerSchema(changed, version)).toThrow(
      `[Goribu] Wrangler ${version}'s config schema uses the keyword "maximum" at #/definitions/Observability/properties/head_sampling_rate, which Goribu cannot check.`,
    );

    const declared = readFileSync(new URL("../src/server.d.ts", import.meta.url), "utf8")
      .match(/type ReservedWranglerField =([^;]+);/)[1].match(/"[^"]+"/g).map((field) => JSON.parse(field));
    const rejected = declared.filter((field) => {
      try { write({ [field]: {} }); return false; } catch (error) { return error.message.startsWith(`[Goribu] wrangler.${field} cannot be set`); }
    });
    expect(rejected).toEqual(declared);
  });
});

describe("remote-only wrangler bindings in goribu dev", () => {
  const appConfig = defineConfig({ ...base, wrangler: { ai: { binding: "AI" }, services: [{ binding: "SEARCH", service: "search-worker", remote: true }] } });

  it("names the bindings and how to log in when Cloudflare access is missing", async () => {
    const getAccess = vi.fn(async () => { throw new Error("[Goribu] Could not read Wrangler's authenticated Cloudflare credentials. Run `pnpm exec goribu cloudflare-login` locally or configure CLOUDFLARE_API_TOKEN for non-interactive use, then rerun `goribu dev`."); });
    await expect(prepareDevelopmentRemoteBindings({ projectRoot: "/app", appConfig, getAccess })).rejects.toThrow(
      "[Goribu] The wrangler bindings AI, SEARCH run on Cloudflare even in goribu dev, so dev needs Cloudflare access. Could not read Wrangler's authenticated Cloudflare credentials. Run `pnpm exec goribu cloudflare-login`",
    );
    expect(getAccess).toHaveBeenCalledWith({ projectRoot: "/app", command: "goribu dev" });
  });

  it("pins Wrangler's dev proxy to the account deploy selects, and skips apps with only local bindings", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", undefined);
    await prepareDevelopmentRemoteBindings({ projectRoot: "/app", appConfig, getAccess: async () => ({ accountId: "a".repeat(32) }) });
    expect(process.env.CLOUDFLARE_ACCOUNT_ID).toBe("a".repeat(32));

    const getAccess = vi.fn();
    const local = defineConfig({ ...base, wrangler: { services: [{ binding: "SEARCH", service: "search-worker" }], vars: { A: "b" } } });
    await prepareDevelopmentRemoteBindings({ projectRoot: "/app", appConfig: local, getAccess });
    expect(getAccess).not.toHaveBeenCalled();
  });
});

it("lists passed-through bindings in goribu check as deployed but not inspected or managed", () => {
  const appConfig = defineConfig({ ...base, wrangler: { ai: { binding: "AI" }, vars: { API_HOST: "example.com" } } });
  const output = formatCheckPlan(createCheckPlan({ appConfig, remoteDatabases: [] }));
  expect(output).toContain(
    "Wrangler bindings from goribu.config.js (deployed as written; not inspected or managed by Goribu)\n  AI -> ai\n",
  );
  expect(output).not.toContain("API_HOST");
});
