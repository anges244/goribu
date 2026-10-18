import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { writeWranglerConfig } from "../src/build/generate-wrangler-config.js";
import { provisionD1 } from "../src/build/provision-d1.js";

const created = [];

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "goribu-wrangler-"));
  created.push(root);
  return root;
}

function readConfig(root) {
  return JSON.parse(readFileSync(join(root, "goribu.wrangler.jsonc"), "utf8").replace(/^\/\/[^\n]*\n/, ""));
}

afterEach(() => {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("writeWranglerConfig", () => {
  it("synthesizes goribu.wrangler.jsonc with explicit workers.dev and no preview URLs or routes for a custom domain", () => {
    const root = makeProject();
    const appConfig = defineConfig({
      name: "goribu-basic-app",
      domain: "app.example.com",
      compatibilityDate: "2026-08-31",
    });

    const { outputFile, config } = writeWranglerConfig({ projectRoot: root, appConfig });

    expect(outputFile).toBe(join(root, "goribu.wrangler.jsonc"));
    expect(readConfig(root)).toEqual(config);
    expect(config).toEqual({
      name: "goribu-basic-app",
      main: ".goribu/worker.js",
      compatibility_date: "2026-08-31",
      assets: { binding: "ASSETS", html_handling: "drop-trailing-slash" },
      workers_dev: true,
      preview_urls: false,
    });

    const { config: domainOnly } = writeWranglerConfig({ projectRoot: root, appConfig: defineConfig({ ...appConfig, workersDev: false }) });
    expect(domainOnly).toMatchObject({ workers_dev: false, preview_urls: false });
  });

  it("omits compatibility_flags when the app declares none", () => {
    const root = makeProject();
    const appConfig = defineConfig({
      name: "goribu-basic-app",
      compatibilityDate: "2026-08-31",
    });

    const { config } = writeWranglerConfig({ projectRoot: root, appConfig });

    expect("compatibility_flags" in config).toBe(false);
  });

  it("carries declared compatibility flags into the Wrangler config", () => {
    const root = makeProject();
    const appConfig = defineConfig({
      name: "goribu-basic-app",
      compatibilityDate: "2026-08-31",
      compatibilityFlags: ["nodejs_compat"],
    });

    const { config } = writeWranglerConfig({ projectRoot: root, appConfig });

    expect(config.compatibility_flags).toEqual(["nodejs_compat"]);
  });

  it("synthesizes a DB binding whose preview id gives dev a name-keyed local D1", () => {
    const root = makeProject();
    const appConfig = defineConfig({
      name: "goribu-basic-app",
      compatibilityDate: "2026-08-31",
      database: { type: "d1", name: "goribu-basic-db" },
    });

    const { config } = writeWranglerConfig({ projectRoot: root, appConfig });

    expect(config.d1_databases).toEqual([
      {
        binding: "DB",
        database_name: "goribu-basic-db",
        preview_database_id: "goribu-basic-db",
      },
    ]);
    expect(config).not.toHaveProperty("hyperdrive");
    expect(config).not.toHaveProperty("compatibility_flags");
  });

  it("synthesizes distinct Hyperdrive placeholders and nodejs_compat for automatic Postgres setup", () => {
    const root = makeProject();
    const appConfig = defineConfig({
      name: "postgres-app",
      compatibilityDate: "2026-08-31",
      database: { type: "postgres" },
    });

    writeWranglerConfig({ projectRoot: root, appConfig });
    const config = readConfig(root);
    expect(config.hyperdrive).toEqual([
      { binding: "POSTGRES", id: "00000000000000000000000000000000" },
      { binding: "POSTGRES_CACHED", id: "00000000000000000000000000000001" },
    ]);
    expect(config.compatibility_flags).toEqual(["nodejs_compat"]);
  });

  it("uses both supplied Hyperdrive IDs directly", () => {
    const root = makeProject();
    const appConfig = defineConfig({
      name: "postgres-app",
      compatibilityDate: "2026-08-31",
      database: {
        type: "postgres",
        hyperdriveId: "11111111111111111111111111111111",
        hyperdriveCachedId: "22222222222222222222222222222222",
      },
    });

    writeWranglerConfig({ projectRoot: root, appConfig });
    expect(readConfig(root).hyperdrive).toEqual([
      { binding: "POSTGRES", id: "11111111111111111111111111111111" },
      { binding: "POSTGRES_CACHED", id: "22222222222222222222222222222222" },
    ]);
  });

  it("preserves author flag order and appends nodejs_compat only when absent for Postgres", () => {
    for (const [type, flags, expected] of [
      ["postgres", ["streams_enable_constructors", "url_standard"], ["streams_enable_constructors", "url_standard", "nodejs_compat"]],
      ["postgres", ["streams_enable_constructors", "nodejs_compat", "url_standard"], ["streams_enable_constructors", "nodejs_compat", "url_standard"]],
      ["d1", ["streams_enable_constructors", "url_standard"], ["streams_enable_constructors", "url_standard"]],
    ]) {
      const root = makeProject();
      const appConfig = defineConfig({
        name: "app",
        compatibilityDate: "2026-08-31",
        compatibilityFlags: flags,
        database: type === "d1" ? { type, name: "app-db" } : { type },
      });

      writeWranglerConfig({ projectRoot: root, appConfig });
      expect(readConfig(root).compatibility_flags).toEqual(expected);
      expect(appConfig.compatibilityFlags).toEqual(flags);
    }
  });

  it("never provisions or synthesizes D1 for a Postgres declaration", async () => {
    const root = makeProject();
    const appConfig = defineConfig({
      name: "postgres-app",
      compatibilityDate: "2026-08-31",
      database: { type: "postgres" },
    });
    const unexpectedD1Call = vi.fn(() => {
      throw new Error("Postgres must not inspect, authenticate for, or mutate D1");
    });

    await expect(provisionD1({
      projectRoot: root,
      appConfig,
      inspectD1: unexpectedD1Call,
      getAccess: unexpectedD1Call,
      requestD1: unexpectedD1Call,
    })).resolves.toBeNull();
    expect(unexpectedD1Call).not.toHaveBeenCalled();

    writeWranglerConfig({ projectRoot: root, appConfig });
    expect(readConfig(root)).not.toHaveProperty("d1_databases");
  });

  it("requires a project root", () => {
    const appConfig = defineConfig({ name: "app", compatibilityDate: "2026-08-31" });
    expect(() => writeWranglerConfig({ appConfig })).toThrow(/requires the application project root/);
  });

  it("requires the application config", () => {
    const root = makeProject();
    expect(() => writeWranglerConfig({ projectRoot: root })).toThrow(/requires the defineConfig\(\) result/);
  });

  it("rejects an unbranded plain object, even one shaped like a config", () => {
    const root = makeProject();
    const lookalike = { name: "goribu-basic-app", compatibilityDate: "2026-08-31" };
    expect(() => writeWranglerConfig({ projectRoot: root, appConfig: lookalike })).toThrow(
      /requires the defineConfig\(\) result/,
    );
  });
});
