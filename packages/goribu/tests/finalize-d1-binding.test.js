import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { finalizeD1Binding } from "../src/build/finalize-d1-binding.js";
import { defineConfig } from "../src/runtime/application-config.js";

const created = [];

afterEach(() => {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("finalizeD1Binding", () => {
  it("adds the provisioned id to the one DB binding in emitted deploy output", () => {
    const root = mkdtempSync(join(tmpdir(), "goribu-finalize-d1-"));
    created.push(root);
    const redirectDir = join(root, ".wrangler", "deploy");
    const outputDir = join(root, ".goribu", "dist", "app");
    mkdirSync(redirectDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      join(redirectDir, "config.json"),
      JSON.stringify({ configPath: "../../.goribu/dist/app/wrangler.json" }),
    );
    writeFileSync(
      join(outputDir, "wrangler.json"),
      JSON.stringify({
        d1_databases: [
          {
            binding: "DB",
            database_name: "app-db",
            preview_database_id: "app-db",
          },
        ],
      }),
    );
    const appConfig = defineConfig({
      name: "app",
      compatibilityDate: "2026-09-03",
      database: { type: "d1", name: "app-db" },
    });

    finalizeD1Binding({
      projectRoot: root,
      appConfig,
      database: { name: "app-db", uuid: "database-id" },
    });

    const result = JSON.parse(
      readFileSync(join(outputDir, "wrangler.json"), "utf8"),
    );
    expect(result.d1_databases[0]).toMatchObject({
      binding: "DB",
      database_name: "app-db",
      database_id: "database-id",
    });
  });

  it("fails closed when build output does not contain exactly one DB binding", () => {
    const root = mkdtempSync(join(tmpdir(), "goribu-finalize-d1-"));
    created.push(root);
    const redirectDir = join(root, ".wrangler", "deploy");
    const outputDir = join(root, ".goribu", "dist", "app");
    mkdirSync(redirectDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      join(redirectDir, "config.json"),
      JSON.stringify({ configPath: "../../.goribu/dist/app/wrangler.json" }),
    );
    writeFileSync(
      join(outputDir, "wrangler.json"),
      JSON.stringify({ d1_databases: [] }),
    );
    const appConfig = defineConfig({
      name: "app",
      compatibilityDate: "2026-09-03",
      database: { type: "d1", name: "app-db" },
    });

    expect(() =>
      finalizeD1Binding({
        projectRoot: root,
        appConfig,
        database: { name: "app-db", uuid: "database-id" },
      }),
    ).toThrow(/does not contain exactly one synthesized DB binding/);
  });
});
