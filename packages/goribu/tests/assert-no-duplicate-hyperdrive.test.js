import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertNoDuplicateHyperdriveDeclaration } from "../src/build/postgres/assert-no-duplicate-hyperdrive.js";
import { defineConfig } from "../src/runtime/application-config.js";

const created = [];
const base = { name: "app", compatibilityDate: "2026-09-03" };
const appConfig = defineConfig({ ...base, database: { type: "postgres" } });

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "goribu-duplicate-hyperdrive-"));
  created.push(root);
  return root;
}

afterEach(() => {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Hyperdrive declaration ownership", () => {
  it("rejects root and environment entries in all author Wrangler formats with BYO guidance", async () => {
    for (const [filename, sources] of [
      ["wrangler.json", ['{"hyperdrive":[]}', '{"env":{"staging":{"hyperdrive":[]}}}']],
      ["wrangler.jsonc", ['{/* author config */ "hyperdrive":[]}', '{"env":{"staging":{"hyperdrive":[]}}}']],
      ["wrangler.toml", ["hyperdrive = []\n", "[env.staging]\nhyperdrive = []\n"]],
    ]) {
      for (const source of sources) {
        const projectRoot = makeProject();
        writeFileSync(join(projectRoot, filename), source);
        await expect(assertNoDuplicateHyperdriveDeclaration({ projectRoot, appConfig }))
          .rejects.toThrow(
            `[Goribu] ${filename} declares hyperdrive while goribu.config.js declares a Postgres database. ` +
            "Remove the hyperdrive entry; Goribu owns the POSTGRES and POSTGRES_CACHED bindings. To use existing Hyperdrive configs, set hyperdriveId and hyperdriveCachedId in goribu.config.js.",
          );
      }
    }
  });

  it("ignores author Hyperdrive entries without a Postgres database", async () => {
    const projectRoot = makeProject();
    writeFileSync(join(projectRoot, "wrangler.jsonc"), '{"hyperdrive":[]}');
    const readConfig = vi.fn(() => { throw new Error("must not inspect"); });
    for (const database of [undefined, { type: "d1", name: "app-db" }]) {
      await expect(assertNoDuplicateHyperdriveDeclaration({
        projectRoot, appConfig: defineConfig({ ...base, database }), readConfig,
      })).resolves.toBeUndefined();
    }
    expect(readConfig).not.toHaveBeenCalled();
  });

  it("allows unrelated fields and leaves the generated Wrangler config outside inspection", async () => {
    const projectRoot = makeProject();
    writeFileSync(join(projectRoot, "wrangler.jsonc"), '{"vars":{"A":"b"}}');
    writeFileSync(join(projectRoot, "goribu.wrangler.jsonc"), '{"hyperdrive":[]}');
    await expect(assertNoDuplicateHyperdriveDeclaration({ projectRoot, appConfig }))
      .resolves.toBeUndefined();
  });

  it("fails closed when Wrangler cannot read a file, preserving the cause", async () => {
    const projectRoot = makeProject();
    writeFileSync(join(projectRoot, "wrangler.toml"), "[[[");
    await expect(assertNoDuplicateHyperdriveDeclaration({ projectRoot, appConfig }))
      .rejects.toThrow(/Could not inspect wrangler.toml.*Fix or remove/);

    const cause = new Error("read failed");
    const readConfig = vi.fn(() => { throw cause; });
    await expect(assertNoDuplicateHyperdriveDeclaration({ projectRoot, appConfig, readConfig }))
      .rejects.toMatchObject({ cause, message: expect.stringMatching(/Could not inspect wrangler.toml.*Fix or remove/) });
    expect(readConfig).toHaveBeenCalledWith({ config: join(projectRoot, "wrangler.toml") });
  });
});
