import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { writeWranglerConfig, GORIBU_HYPERDRIVE_PLACEHOLDER } from "../src/build/generate-wrangler-config.js";
import { finalizeHyperdriveBindings } from "../src/build/postgres/finalize-hyperdrive-bindings.js";

const base = { name: "app", compatibilityDate: "2026-09-23" };
const appConfig = defineConfig({ ...base, database: { type: "postgres" } });
const hyperdrive = { id: "a".repeat(32), cachedId: "b".repeat(32) };
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(config = appConfig) {
  const projectRoot = mkdtempSync(join(tmpdir(), "goribu-finalize-hyperdrive-"));
  roots.push(projectRoot);
  const generated = writeWranglerConfig({ projectRoot, appConfig: config }).config;
  const configFile = join(projectRoot, ".goribu", "dist", "app", "wrangler.json");
  const redirectDir = join(projectRoot, ".wrangler", "deploy");
  mkdirSync(dirname(configFile), { recursive: true });
  mkdirSync(redirectDir, { recursive: true });
  writeFileSync(join(redirectDir, "config.json"), JSON.stringify({ configPath: "../../.goribu/dist/app/wrangler.json" }));
  writeFileSync(configFile, JSON.stringify(generated));
  return {
    configFile, generated,
    run: (overrides = {}) => finalizeHyperdriveBindings({ projectRoot, appConfig: config, hyperdrive, ...overrides }),
  };
}

describe("finalizeHyperdriveBindings", () => {
  it("replaces both generated placeholders and preserves all unrelated configuration", () => {
    const f = fixture();
    expect(f.run()).toEqual({ configFile: f.configFile, ...hyperdrive });
    expect(JSON.parse(readFileSync(f.configFile, "utf8"))).toEqual({
      ...f.generated,
      hyperdrive: [{ binding: "POSTGRES", id: hyperdrive.id }, { binding: "POSTGRES_CACHED", id: hyperdrive.cachedId }],
    });
  });

  it("keeps validated BYO IDs, matching bindings by name regardless of order", () => {
    const byo = defineConfig({ ...base, database: { type: "postgres", hyperdriveId: hyperdrive.id, hyperdriveCachedId: hyperdrive.cachedId } });
    const f = fixture(byo);
    f.generated.hyperdrive.reverse();
    writeFileSync(f.configFile, JSON.stringify(f.generated));
    f.run();
    expect(JSON.parse(readFileSync(f.configFile, "utf8"))).toEqual(f.generated);
    expect(() => f.run({ hyperdrive: { id: "c".repeat(32), cachedId: hyperdrive.cachedId } }))
      .toThrow(/\[Goribu\].*do not match hyperdriveId and hyperdriveCachedId.*goribu deploy/);
  });

  it("rejects missing, duplicate, unexpected, or modified bindings without writing either ID", () => {
    const f = fixture();
    const [primary, cached] = f.generated.hyperdrive;
    for (const bindings of [
      undefined, null, {}, [], [primary], [primary, cached, { binding: "EXTRA", id: "c".repeat(32) }],
      [primary, primary], [null, cached], [primary, { ...cached, binding: "OTHER" }],
      [primary, { ...cached, id: primary.id }], [primary, { ...cached, id: hyperdrive.cachedId }],
      [{ binding: "POSTGRES" }, cached], [primary, { ...cached, remote: false }],
      [primary, { ...cached, localConnectionString: "unexpected" }],
    ]) {
      const before = JSON.stringify({ ...f.generated, hyperdrive: bindings });
      writeFileSync(f.configFile, before);
      expect(() => f.run()).toThrow(/\[Goribu\].*exactly the two synthesized POSTGRES and POSTGRES_CACHED bindings.*goribu build/);
      expect(readFileSync(f.configFile, "utf8")).toBe(before);
    }
  });

  it("rejects unresolved IDs and invalid inputs before touching the config", () => {
    const f = fixture();
    const before = readFileSync(f.configFile, "utf8");
    for (const value of [undefined, {}, { id: "", cachedId: hyperdrive.cachedId },
      { id: "not-an-id", cachedId: hyperdrive.cachedId }, { id: hyperdrive.id, cachedId: hyperdrive.id },
      { id: GORIBU_HYPERDRIVE_PLACEHOLDER, cachedId: hyperdrive.cachedId }]) {
      expect(() => f.run({ hyperdrive: value })).toThrow(/two distinct, resolved 32-character hexadecimal Hyperdrive IDs/);
    }
    expect(() => f.run({ appConfig: defineConfig(base) })).toThrow(/Postgres database declaration/);
    expect(() => f.run({ projectRoot: "" })).toThrow(/requires projectRoot/);
    expect(readFileSync(f.configFile, "utf8")).toBe(before);
  });

  it("uses the shared deploy reader's teaching errors without retaining JSON parser contents", () => {
    const f = fixture();
    writeFileSync(f.configFile, "{invalid json");
    let error;
    try { f.run(); } catch (caught) { error = caught; }
    expect(error.message).toMatch(/\[Goribu\].*could not read the emitted Wrangler config.*goribu build/);
    expect(error.cause).toBeUndefined();
    expect(readFileSync(f.configFile, "utf8")).toBe("{invalid json");
  });
});
