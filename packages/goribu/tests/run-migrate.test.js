import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { runMigrate } from "../src/build/migrations/run-migrate.js";
import { readMigrations } from "../src/build/migrations/read-migrations.js";

let root;

const appConfig = defineConfig({
  name: "app",
  compatibilityDate: "2026-09-03",
  database: { type: "d1", name: "app-db" },
});
const loadConfig = async () => appConfig;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "goribu-run-migrate-"));
  mkdirSync(join(root, "migrations"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function migration(name, up) {
  writeFileSync(join(root, "migrations", `${name}.sql`), `-- migrate:up\n${up}\n-- migrate:down\n`);
}

// A Wrangler stand-in: it records every call, reads the applied-file contents before
// the temp file is cleaned up, and answers the applied-ledger SELECT with canned rows.
function fakeExecute(appliedRows = []) {
  const calls = [];
  const files = [];
  const execute = async (options) => {
    calls.push(options);
    if (options.file !== undefined) files.push(readFileSync(options.file, "utf8"));
    if (typeof options.command === "string" && options.command.startsWith("SELECT name, checksum")) {
      return [{ results: appliedRows }];
    }
    return undefined;
  };
  execute.calls = calls;
  execute.files = files;
  return execute;
}

const capture = () => {
  const out = { text: "", write(t) { this.text += t; } };
  return out;
};

describe("runMigrate", () => {
  it("ensures the tracking table, reads the ledger, then applies pending in order", async () => {
    migration("0001_first", "CREATE TABLE a (x);");
    migration("0002_second", "CREATE TABLE b (y);");
    const execute = fakeExecute();
    const stdout = capture();

    await runMigrate({ projectRoot: root, loadConfig, execute, stdout });

    expect(execute.calls[0].command).toMatch(/^CREATE TABLE IF NOT EXISTS _goribu_migrations/);
    expect(execute.calls[1].command).toMatch(/^SELECT name, checksum FROM _goribu_migrations/);
    expect(execute.calls.slice(2).map((c) => c.file !== undefined)).toEqual([true, true]);
    expect(execute.calls.every((c) => c.target === "local")).toBe(true);
    expect(stdout.text).toContain("✓ Applied 0001_first to local");
    expect(stdout.text).toContain("✓ Applied 0002_second to local");
  });

  it("writes each migration's forward SQL and ledger insert into one file", async () => {
    migration("0001_first", "CREATE TABLE a (x);");
    const execute = fakeExecute();
    const [checksum] = readMigrations({ migrationsDir: join(root, "migrations") }).map((m) => m.checksum);

    await runMigrate({ projectRoot: root, loadConfig, execute, stdout: capture() });

    expect(execute.files[0]).toContain("CREATE TABLE a (x);");
    expect(execute.files[0]).toContain(
      `INSERT INTO _goribu_migrations (name, checksum) VALUES ('0001_first', '${checksum}');`,
    );
  });

  it("does nothing and reports when already up to date", async () => {
    migration("0001_first", "CREATE TABLE a (x);");
    const [applied] = readMigrations({ migrationsDir: join(root, "migrations") });
    const execute = fakeExecute([{ name: applied.name, checksum: applied.checksum }]);
    const stdout = capture();

    await runMigrate({ projectRoot: root, loadConfig, execute, stdout });

    expect(execute.files).toHaveLength(0);
    expect(stdout.text).toContain("Already up to date on local");
  });

  it("refuses to mutate when an applied migration has drifted", async () => {
    migration("0001_first", "CREATE TABLE a (x);");
    const execute = fakeExecute([{ name: "0001_first", checksum: "stale-checksum" }]);

    await expect(
      runMigrate({ projectRoot: root, loadConfig, execute, stdout: capture() }),
    ).rejects.toThrow(/history has drifted/);
    expect(execute.files).toHaveLength(0);
  });

  it("refuses an empty scaffold before any database call", async () => {
    writeFileSync(join(root, "migrations", "0001_empty.sql"), "-- migrate:up\n-- migrate:down\n");
    const execute = fakeExecute();

    await expect(
      runMigrate({ projectRoot: root, loadConfig, execute, stdout: capture() }),
    ).rejects.toThrow(/0001_empty has no SQL under -- migrate:up/);
    expect(execute.calls).toHaveLength(0);
  });

  it("refuses when no database is declared", async () => {
    const noDb = defineConfig({ name: "app", compatibilityDate: "2026-09-03" });
    await expect(
      runMigrate({ projectRoot: root, loadConfig: async () => noDb, execute: fakeExecute(), stdout: capture() }),
    ).rejects.toThrow(/No database is declared/);
  });
});
