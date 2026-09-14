import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { writeWranglerConfig } from "../src/build/generate-wrangler-config.js";

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
  it("synthesizes goribu.wrangler.jsonc from the application config", () => {
    const root = makeProject();
    const appConfig = defineConfig({
      name: "goribu-basic-app",
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
    });
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
