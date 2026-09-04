import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { runMigrate } from "../src/build/migrations/run-migrate.js";
import { runMigrateDown } from "../src/build/migrations/run-migrate-down.js";
import { runMigrateNew } from "../src/build/migrations/run-migrate-new.js";
import { runMigrateSeed } from "../src/build/migrations/run-migrate-seed.js";
import { runMigrateStatus } from "../src/build/migrations/run-migrate-status.js";
import { resolveMigrationContext } from "../src/build/migrations/migration-context.js";
import { executeD1, lastResultRows } from "../src/build/migrations/wrangler-d1.js";

// A real end-to-end exercise of `goribu migrate` against a local D1 through the pinned
// Wrangler. It proves the scaffold/apply/status/down/seed path, atomic ledger changes,
// idempotency, and rollback of both forward and down batches when their SQL fails.
let root;
let context;
const loadConfig = async () =>
  defineConfig({
    name: "migrate-int",
    compatibilityDate: "2026-09-03",
    database: { type: "d1", name: "migrate-int-db" },
  });
const capture = () => ({ text: "", write(t) { this.text += t; } });

function migration(name, up, down = "") {
  writeFileSync(
    join(root, "migrations", `${name}.sql`),
    `-- migrate:up\n${up}\n-- migrate:down\n${down}\n`,
  );
}

function query(command) {
  return executeD1({
    projectRoot: root,
    configPath: context.configPath,
    database: context.database,
    persistTo: context.persistTo,
    target: "local",
    command,
    json: true,
  });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "goribu-migrate-int-"));
  mkdirSync(join(root, "migrations"), { recursive: true });
  context = await resolveMigrationContext({ projectRoot: root, loadConfig });
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("goribu migrate (local, real Wrangler)", () => {
  it("scaffolds and applies forward SQL, records the ledger, then is idempotent", { timeout: 120000 }, async () => {
    const firstMigration = runMigrateNew({
      projectRoot: root,
      name: "create widgets",
      stdout: capture(),
    });
    writeFileSync(
      firstMigration.file,
      "-- migrate:up\nCREATE TABLE widgets (name TEXT);\n" +
        "-- migrate:down\nDROP TABLE widgets;\n",
    );
    const secondMigration = runMigrateNew({
      projectRoot: root,
      name: "seed widgets",
      stdout: capture(),
    });
    writeFileSync(
      secondMigration.file,
      "-- migrate:up\nINSERT INTO widgets (name) VALUES ('gizmo');\n" +
        "-- migrate:down\nDELETE FROM widgets WHERE name = 'gizmo';\n",
    );

    const applied = capture();
    await runMigrate({ projectRoot: root, loadConfig, stdout: applied });
    expect(applied.text).toContain("✓ Applied 0001_create-widgets to local");
    expect(applied.text).toContain("✓ Applied 0002_seed-widgets to local");

    expect(lastResultRows(await query("SELECT name FROM widgets"))).toEqual([{ name: "gizmo" }]);
    expect(
      lastResultRows(await query("SELECT name FROM _goribu_migrations ORDER BY name")),
    ).toEqual([{ name: "0001_create-widgets" }, { name: "0002_seed-widgets" }]);

    const repeated = capture();
    await runMigrate({ projectRoot: root, loadConfig, stdout: repeated });
    expect(repeated.text).toContain("Already up to date on local");
    // Idempotent: the seed insert did not run twice.
    expect(lastResultRows(await query("SELECT count(*) AS n FROM widgets"))).toEqual([{ n: 1 }]);
  });

  it("rolls back one migration atomically, then seeds without changing the ledger", { timeout: 120000 }, async () => {
    const status = capture();
    await runMigrateStatus({ projectRoot: root, loadConfig, stdout: status });
    expect(status.text).toContain("Applied (2):");
    expect(status.text).toContain("Pending (0):");

    const down = capture();
    await runMigrateDown({ projectRoot: root, loadConfig, stdout: down });
    expect(down.text).toContain("✓ Rolled back 0002_seed-widgets from local");
    expect(lastResultRows(await query("SELECT name FROM widgets"))).toEqual([]);
    expect(
      lastResultRows(await query("SELECT name FROM _goribu_migrations ORDER BY name")),
    ).toEqual([{ name: "0001_create-widgets" }]);

    writeFileSync(
      join(root, "migrations", "seed.sql"),
      "INSERT INTO widgets (name) VALUES ('local-seed');\n",
    );
    const seed = capture();
    await runMigrateSeed({ projectRoot: root, loadConfig, stdout: seed });
    expect(seed.text).toContain("✓ Ran migrations/seed.sql on local");
    expect(lastResultRows(await query("SELECT name FROM widgets"))).toEqual([
      { name: "local-seed" },
    ]);
    expect(
      lastResultRows(await query("SELECT name FROM _goribu_migrations ORDER BY name")),
    ).toEqual([{ name: "0001_create-widgets" }]);
  });

  it("rolls back a partially-successful migration and records nothing", { timeout: 120000 }, async () => {
    // A successful schema statement precedes the failing one, so this proves the whole
    // migration — not just the ledger insert — is rolled back as one transaction.
    migration(
      "0003_broken",
      "CREATE TABLE half_built (x);\nINSERT INTO missing_table (x) VALUES (1);",
    );

    await expect(runMigrate({ projectRoot: root, loadConfig, stdout: capture() })).rejects.toThrow(
      /Wrangler could not run the local D1 SQL/,
    );

    const status = capture();
    await runMigrateStatus({ projectRoot: root, loadConfig, stdout: status });
    expect(status.text).toContain("Pending (1):\n  - 0003_broken");
    // The earlier CREATE TABLE rolled back with the failure.
    expect(
      lastResultRows(
        await query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'half_built'"),
      ),
    ).toEqual([]);
    expect(
      lastResultRows(await query("SELECT name FROM _goribu_migrations WHERE name = '0003_broken'")),
    ).toEqual([]);
  });

  it("keeps the schema and ledger row when rollback SQL fails", { timeout: 120000 }, async () => {
    migration(
      "0003_broken",
      "CREATE TABLE rollback_probe (x);",
      "DROP TABLE rollback_probe;\nINSERT INTO missing_table (x) VALUES (1);",
    );
    await runMigrate({ projectRoot: root, loadConfig, stdout: capture() });

    await expect(
      runMigrateDown({ projectRoot: root, loadConfig, stdout: capture() }),
    ).rejects.toThrow(/Wrangler could not run the local D1 SQL/);

    expect(
      lastResultRows(
        await query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rollback_probe'"),
      ),
    ).toEqual([{ name: "rollback_probe" }]);
    expect(
      lastResultRows(await query("SELECT name FROM _goribu_migrations WHERE name = '0003_broken'")),
    ).toEqual([{ name: "0003_broken" }]);
  });
});
