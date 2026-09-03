import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { runMigrate } from "../src/build/migrations/run-migrate.js";
import { runMigrateStatus } from "../src/build/migrations/run-migrate-status.js";
import { resolveMigrationContext } from "../src/build/migrations/migration-context.js";
import { executeD1, lastResultRows } from "../src/build/migrations/wrangler-d1.js";

// A real end-to-end exercise of `goribu migrate` against a local D1 through the pinned
// Wrangler. It proves the engine applies forward SQL, records the ledger atomically with
// it, is idempotent, and never records a migration whose SQL failed.
let root;
let context;
const loadConfig = async () =>
  defineConfig({
    name: "migrate-int",
    compatibilityDate: "2026-09-03",
    database: { type: "d1", name: "migrate-int-db" },
  });
const capture = () => ({ text: "", write(t) { this.text += t; } });

function migration(name, up) {
  writeFileSync(join(root, "migrations", `${name}.sql`), `-- migrate:up\n${up}\n-- migrate:down\n`);
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
  it("applies forward SQL and records the ledger, then is idempotent", { timeout: 120000 }, async () => {
    migration("0001_create-widgets", "CREATE TABLE widgets (name TEXT);");
    migration("0002_seed-widgets", "INSERT INTO widgets (name) VALUES ('gizmo');");

    const first = capture();
    await runMigrate({ projectRoot: root, loadConfig, stdout: first });
    expect(first.text).toContain("✓ Applied 0001_create-widgets to local");
    expect(first.text).toContain("✓ Applied 0002_seed-widgets to local");

    expect(lastResultRows(await query("SELECT name FROM widgets"))).toEqual([{ name: "gizmo" }]);
    expect(
      lastResultRows(await query("SELECT name FROM _goribu_migrations ORDER BY name")),
    ).toEqual([{ name: "0001_create-widgets" }, { name: "0002_seed-widgets" }]);

    const second = capture();
    await runMigrate({ projectRoot: root, loadConfig, stdout: second });
    expect(second.text).toContain("Already up to date on local");
    // Idempotent: the seed insert did not run twice.
    expect(lastResultRows(await query("SELECT count(*) AS n FROM widgets"))).toEqual([{ n: 1 }]);
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
});
