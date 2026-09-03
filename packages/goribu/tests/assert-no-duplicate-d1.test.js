import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertNoDuplicateD1Declaration } from "../src/build/assert-no-duplicate-d1.js";
import { defineConfig } from "../src/runtime/application-config.js";

const created = [];

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "goribu-duplicate-d1-"));
  created.push(root);
  return root;
}

afterEach(() => {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("D1 declaration ownership", () => {
  it("rejects top-level and environment D1 declarations in author Wrangler files", async () => {
    const appConfig = defineConfig({
      name: "app",
      compatibilityDate: "2026-09-03",
      database: { type: "d1", name: "app-db" },
    });

    for (const source of [
      '{ "d1_databases": [] }',
      '{ "env": { "production": { "d1_databases": [] } } }',
    ]) {
      const root = makeProject();
      writeFileSync(join(root, "wrangler.jsonc"), source);
      await expect(
        assertNoDuplicateD1Declaration({ projectRoot: root, appConfig }),
      ).rejects.toThrow(/declares d1_databases.*Remove the d1_databases declaration/);
    }
  });

  it("allows unrelated author Wrangler fields and skips inspection without D1 config", async () => {
    const root = makeProject();
    writeFileSync(join(root, "wrangler.jsonc"), '{ "vars": { "A": "b" } }');
    const d1Config = defineConfig({
      name: "app",
      compatibilityDate: "2026-09-03",
      database: { type: "d1", name: "app-db" },
    });
    await expect(
      assertNoDuplicateD1Declaration({ projectRoot: root, appConfig: d1Config }),
    ).resolves.toBeUndefined();

    writeFileSync(join(root, "wrangler.jsonc"), "not jsonc");
    const plainConfig = defineConfig({
      name: "app",
      compatibilityDate: "2026-09-03",
    });
    await expect(
      assertNoDuplicateD1Declaration({ projectRoot: root, appConfig: plainConfig }),
    ).resolves.toBeUndefined();
  });

  it("fails closed when an author Wrangler file cannot be inspected", async () => {
    const root = makeProject();
    writeFileSync(join(root, "wrangler.toml"), "[[[");
    const appConfig = defineConfig({
      name: "app",
      compatibilityDate: "2026-09-03",
      database: { type: "d1", name: "app-db" },
    });

    await expect(
      assertNoDuplicateD1Declaration({ projectRoot: root, appConfig }),
    ).rejects.toThrow(/Could not inspect wrangler.toml.*Fix or remove/);
  });
});
