import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { writeWranglerConfig } from "../src/build/generate-wrangler-config.js";
import { finalizeD1Binding } from "../src/build/finalize-d1-binding.js";
import { finalizeKVBinding } from "../src/build/finalize-kv-binding.js";
import { finalizeR2Account } from "../src/build/finalize-r2-account.js";

const roots = [];
function project() {
  const root = mkdtempSync(join(tmpdir(), "goribu-resource-output-"));
  roots.push(root);
  mkdirSync(join(root, ".wrangler", "deploy"), { recursive: true });
  writeFileSync(join(root, ".wrangler", "deploy", "config.json"), JSON.stringify({ configPath: "../../output.json" }));
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const appConfig = defineConfig({ name: "app", compatibilityDate: "2026-09-04", database: { type: "d1", name: "app-db" }, kv: { name: "app-kv" } });
const database = { name: "app-db", uuid: "db-id" };
const namespace = { title: "app-kv", id: "a".repeat(32) };

describe("shared deploy artifact boundary", () => {
  it("attaches the signer account without losing app vars or bindings", () => {
    const projectRoot = project();
    const r2Config = defineConfig({ ...appConfig, r2: { name: "app-files" } });
    const { config } = writeWranglerConfig({ projectRoot, appConfig: r2Config });
    const output = join(projectRoot, "output.json");
    writeFileSync(output, JSON.stringify({ ...config, vars: { APP_LABEL: "example", CLOUDFLARE_ACCOUNT_ID: "app-owned", GORIBU_R2_ACCOUNT_ID: "stale" } }));
    const accountId = "a".repeat(32);
    finalizeR2Account({ projectRoot, appConfig: r2Config, accountId });
    const result = JSON.parse(readFileSync(output, "utf8"));
    expect(result).toEqual({ ...config, vars: { APP_LABEL: "example", CLOUDFLARE_ACCOUNT_ID: "app-owned", GORIBU_R2_ACCOUNT_ID: accountId } });
    expect(() => finalizeR2Account({ projectRoot, appConfig: r2Config, accountId: "invalid" })).toThrow(/\[Goribu\].*account ID/);
    writeFileSync(output, JSON.stringify({ ...config, vars: [] }));
    expect(() => finalizeR2Account({ projectRoot, appConfig: r2Config, accountId })).toThrow(/vars are not an object/);
  });

  it("attaches both resource ids without discarding either binding or local storage identity", () => {
    const projectRoot = project();
    const { config } = writeWranglerConfig({ projectRoot, appConfig });
    const output = join(projectRoot, "output.json");
    writeFileSync(output, JSON.stringify(config));
    finalizeKVBinding({ projectRoot, appConfig, namespace });
    finalizeD1Binding({ projectRoot, appConfig, database });
    const result = JSON.parse(readFileSync(output, "utf8"));
    expect(result.d1_databases).toEqual([{ ...config.d1_databases[0], database_id: database.uuid }]);
    expect(result.kv_namespaces).toEqual([{ ...config.kv_namespaces[0], id: namespace.id }]);
    expect(result.assets).toEqual(config.assets);
  });

  it("refuses symlink escapes for both resources without modifying the external target", () => {
    const projectRoot = project();
    const outside = project();
    const target = join(outside, "external.json");
    writeFileSync(target, "{}");
    symlinkSync(target, join(projectRoot, "output.json"));
    expect(() => finalizeKVBinding({ projectRoot, appConfig, namespace })).toThrow(/resolves outside the application/);
    expect(() => finalizeD1Binding({ projectRoot, appConfig, database })).toThrow(/resolves outside the application/);
    expect(readFileSync(target, "utf8")).toBe("{}");
  });
});
