import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { runMigrate } from "../src/build/migrations/run-migrate.js";
import { runMigrateNew } from "../src/build/migrations/run-migrate-new.js";
import { runMigrateSeed } from "../src/build/migrations/run-migrate-seed.js";
import { runMigrateStatus } from "../src/build/migrations/run-migrate-status.js";
import { runD1 } from "../src/build/run-d1.js";
import { resolveMigrationContext } from "../src/build/migrations/migration-context.js";
import { executeD1, lastResultRows } from "../src/build/migrations/wrangler-d1.js";

// A real end-to-end exercise of `goribu migrate` against a local D1 through the pinned
// Wrangler. It proves scaffold/apply/status/seed, legacy checksums, atomic ledger
// changes, idempotency, and rollback of a forward batch when its SQL fails.
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
  writeFileSync(
    join(root, "migrations", `${name}.sql`),
    `${up}\n`,
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

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "goribu-migrate-int-"));
  mkdirSync(join(root, "migrations"), { recursive: true });
  context = await resolveMigrationContext({ projectRoot: root, loadConfig });
});
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

async function applyWidgetMigrations() {
  const firstMigration = runMigrateNew({
    projectRoot: root,
    name: "create widgets",
    stdout: capture(),
  });
  appendFileSync(firstMigration.file, "CREATE TABLE widgets (name TEXT);\n");
  const secondMigration = runMigrateNew({
    projectRoot: root,
    name: "seed widgets",
    stdout: capture(),
  });
  appendFileSync(secondMigration.file, "INSERT INTO widgets (name) VALUES ('gizmo');\n");

  const applied = capture();
  await runMigrate({ projectRoot: root, loadConfig, stdout: applied });
  return applied;
}

describe("goribu migrate (local, real Wrangler)", () => {
  it("scaffolds and applies forward SQL, records the ledger, then is idempotent", { timeout: 120000 }, async () => {
    const applied = await applyWidgetMigrations();
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

  it("reports status, then seeds without changing the ledger", { timeout: 120000 }, async () => {
    await applyWidgetMigrations();
    const status = capture();
    await runMigrateStatus({ projectRoot: root, loadConfig, stdout: status });
    expect(status.text).toContain("Applied (2):");
    expect(status.text).toContain("Pending (0):");

    writeFileSync(
      join(root, "migrations", "seed.sql"),
      "INSERT INTO widgets (name) VALUES ('local-seed');\n",
    );
    const seed = capture();
    await runMigrateSeed({ projectRoot: root, loadConfig, stdout: seed });
    expect(seed.text).toContain("✓ Ran migrations/seed.sql on local");
    expect(lastResultRows(await query("SELECT name FROM widgets"))).toEqual([
      { name: "gizmo" },
      { name: "local-seed" },
    ]);
    expect(
      lastResultRows(await query("SELECT name FROM _goribu_migrations ORDER BY name")),
    ).toEqual([{ name: "0001_create-widgets" }, { name: "0002_seed-widgets" }]);
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

  it("preserves the legacy whole-file checksum and never executes its down section", { timeout: 120000 }, async () => {
    // The scaffold layout 0.9.3 generated: header, up marker, down marker.
    const original =
      "-- create-feedback\n" +
      "-- Write the forward SQL under migrate:up. The migrate:down section is optional;\n" +
      "-- leave it empty when the change cannot be honestly reversed.\n\n" +
      "-- migrate:up\n" +
      "CREATE TABLE feedback (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  message TEXT NOT NULL,\n  created_at TEXT NOT NULL\n);\n\n" +
      "-- migrate:down\n";
    const legacy = original + "DROP TABLE feedback;\n";
    const file = join(root, "migrations/0001_create-feedback.sql");
    writeFileSync(file, legacy.replace(/\n/g, "\r\n"));
    const checksum = createHash("sha256").update(legacy).digest("hex");
    await runMigrate({ projectRoot: root, loadConfig, stdout: capture() });
    expect(lastResultRows(await query("SELECT name, checksum FROM _goribu_migrations"))).toEqual([
      { name: "0001_create-feedback", checksum },
    ]);
    await query("INSERT INTO feedback (message, created_at) VALUES ('kept', 'today')");
    const repeated = capture();
    await runMigrate({ projectRoot: root, loadConfig, stdout: repeated });
    expect(repeated.text).toContain("Already up to date on local (1 applied)");
    expect(lastResultRows(await query("SELECT message FROM feedback"))).toEqual([{ message: "kept" }]);
    // Even the ignored legacy down section remains part of the historical checksum.
    writeFileSync(file, original);
    await expect(runMigrate({ projectRoot: root, loadConfig, stdout: capture() })).rejects.toThrow(/history has drifted/);
  });

  it("refuses a fresh scaffold before creating a ledger, then applies added SQL", { timeout: 120000 }, async () => {
    const { file } = runMigrateNew({ projectRoot: root, name: "widgets", stdout: capture() });
    await expect(runMigrate({ projectRoot: root, loadConfig, stdout: capture() })).rejects.toThrow(/has no forward SQL/);
    expect(lastResultRows(await query("SELECT name FROM sqlite_master WHERE name = '_goribu_migrations'"))).toEqual([]);
    appendFileSync(file, "CREATE TABLE widgets (name TEXT);\nINSERT INTO widgets VALUES ('new');\n");
    await runMigrate({ projectRoot: root, loadConfig, stdout: capture() });
    expect(lastResultRows(await query("SELECT name FROM widgets"))).toEqual([{ name: "new" }]);
    expect(lastResultRows(await query("SELECT name, checksum FROM _goribu_migrations"))).toEqual([
      { name: "0001_widgets", checksum: createHash("sha256").update(readFileSync(file)).digest("hex") },
    ]);
  });

  it("runs `goribu d1` SQL against the same local database", { timeout: 120000 }, async () => {
    await query("CREATE TABLE widgets (name TEXT)");
    await runD1({ projectRoot: root, loadConfig, sql: "INSERT INTO widgets (name) VALUES ('ad-hoc')" });
    expect(lastResultRows(await query("SELECT name FROM widgets WHERE name = 'ad-hoc'"))).toEqual([
      { name: "ad-hoc" },
    ]);
  });
});
