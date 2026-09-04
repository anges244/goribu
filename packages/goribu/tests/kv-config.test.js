import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { assertNoDuplicateKVDeclaration } from "../src/build/assert-no-duplicate-kv.js";
import { writeWranglerConfig } from "../src/build/generate-wrangler-config.js";
import { finalizeKVBinding } from "../src/build/finalize-kv-binding.js";

const base = { name: "app", compatibilityDate: "2026-09-04" };
const appConfig = defineConfig({ ...base, kv: { name: "app-kv" }, database: { type: "d1", name: "app-db" } });
const namespace = { title: "app-kv", id: "a".repeat(32) };
const roots = [];
function project() {
  const root = mkdtempSync(join(tmpdir(), "goribu-kv-config-"));
  roots.push(root);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("KV declaration and binding ownership", () => {
  it("snapshots one namespace and rejects malformed or competing configuration", () => {
    const kv = { name: "app-kv" };
    const config = defineConfig({ ...base, kv });
    kv.name = "changed";
    expect(config.kv).toEqual({ name: "app-kv" });
    expect(Object.isFrozen(config.kv)).toBe(true);
    for (const value of [null, [], {}, { name: "" }, { name: "a/b" }, { name: "A" }, { name: "a".repeat(64) }, { name: "app-kv", id: "id" }, { name: "app-kv", binding: "OTHER" }, { name: "app-kv", [Symbol()]: true }]) {
      expect(() => defineConfig({ ...base, kv: value })).toThrow(/\[Goribu\].*kv/);
    }
    const accessor = { get name() { throw new Error("must not evaluate"); } };
    expect(() => defineConfig({ ...base, kv: accessor })).toThrow(/ordinary enumerable value/);
  });

  it("rejects root and environment Wrangler declarations and unreadable configs", async () => {
    const projectRoot = project();
    for (const [filename, source] of [
      ["wrangler.json", '{"kv_namespaces":[]}'],
      ["wrangler.jsonc", '{"env":{"production":{"kv_namespaces":[]}}}'],
      ["wrangler.toml", '[[kv_namespaces]]\nbinding = "KV"'],
    ]) {
      const path = join(projectRoot, filename);
      writeFileSync(path, source);
      await expect(assertNoDuplicateKVDeclaration({ projectRoot, appConfig })).rejects.toThrow(/Remove the kv_namespaces declaration/);
      rmSync(path);
    }
    writeFileSync(join(projectRoot, "wrangler.json"), "broken");
    await expect(assertNoDuplicateKVDeclaration({ projectRoot, appConfig })).rejects.toThrow(/Fix or remove/);
    await expect(assertNoDuplicateKVDeclaration({ projectRoot, appConfig: defineConfig(base) })).resolves.toBeUndefined();
    writeFileSync(join(projectRoot, "wrangler.json"), '{"vars":{"A":"b"}}');
    await expect(assertNoDuplicateKVDeclaration({ projectRoot, appConfig })).resolves.toBeUndefined();
  });

  it("adds the production KV id while preserving the local store and D1 binding", () => {
    const projectRoot = project();
    const { config } = writeWranglerConfig({ projectRoot, appConfig });
    expect(config.kv_namespaces).toEqual([{ binding: "KV", preview_id: "app-kv" }]);
    const output = join(projectRoot, "output.json");
    const redirectDir = join(projectRoot, ".wrangler", "deploy");
    mkdirSync(redirectDir, { recursive: true });
    writeFileSync(join(redirectDir, "config.json"), JSON.stringify({ configPath: "../../output.json" }));
    writeFileSync(output, JSON.stringify(config));
    finalizeKVBinding({ projectRoot, appConfig, namespace });
    const finalized = JSON.parse(readFileSync(output, "utf8"));
    expect(finalized.kv_namespaces).toEqual([{ binding: "KV", preview_id: "app-kv", id: namespace.id }]);
    expect(finalized.d1_databases).toEqual(config.d1_databases);

    for (const bindings of [[], [{ binding: "OTHER", preview_id: "app-kv" }], [{ binding: "KV", preview_id: "wrong" }], [...config.kv_namespaces, ...config.kv_namespaces], [{ binding: "KV", preview_id: "app-kv", remote: true }]]) {
      writeFileSync(output, JSON.stringify({ kv_namespaces: bindings }));
      expect(() => finalizeKVBinding({ projectRoot, appConfig, namespace })).toThrow(/exactly one synthesized local KV binding/);
    }
    writeFileSync(join(redirectDir, "config.json"), JSON.stringify({ configPath: "../../../outside.json" }));
    expect(() => finalizeKVBinding({ projectRoot, appConfig, namespace })).toThrow(/outside the application/);
  });
});
