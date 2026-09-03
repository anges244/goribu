import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { runMigrateStatus } from "../src/build/migrations/run-migrate-status.js";
import { readMigrations } from "../src/build/migrations/read-migrations.js";

let root;
const appConfig = defineConfig({
  name: "app",
  compatibilityDate: "2026-09-03",
  database: { type: "d1", name: "app-db" },
});
const loadConfig = async () => appConfig;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "goribu-migrate-status-"));
  mkdirSync(join(root, "migrations"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function migration(name) {
  writeFileSync(join(root, "migrations", `${name}.sql`), "-- migrate:up\nSELECT 1;\n-- migrate:down\n");
}

const capture = () => ({ text: "", write(t) { this.text += t; } });

// Answer the existence probe from a settable table state, and the ledger read from rows.
function fakeExecute({ tableExists = false, appliedRows = [] } = {}) {
  const calls = [];
  const execute = async (options) => {
    calls.push(options);
    if (typeof options.command !== "string") return undefined;
    if (options.command.includes("sqlite_master")) {
      return [{ results: tableExists ? [{ name: "_goribu_migrations" }] : [] }];
    }
    if (options.command.startsWith("SELECT name, checksum")) {
      return [{ results: appliedRows }];
    }
    return undefined;
  };
  execute.calls = calls;
  return execute;
}

describe("runMigrateStatus", () => {
  it("never creates the tracking table, treating an absent one as nothing applied", async () => {
    migration("0001_first");
    const execute = fakeExecute({ tableExists: false });
    const stdout = capture();

    await runMigrateStatus({ projectRoot: root, loadConfig, execute, stdout });

    expect(execute.calls.some((c) => /CREATE TABLE/i.test(c.command ?? ""))).toBe(false);
    expect(execute.calls.some((c) => (c.command ?? "").includes("sqlite_master"))).toBe(true);
    expect(stdout.text).toContain("Applied (0):");
    expect(stdout.text).toContain("Pending (1):\n  - 0001_first");
  });

  it("reports applied, pending, and drift together", async () => {
    migration("0001_first");
    migration("0002_second");
    const [first] = readMigrations({ migrationsDir: join(root, "migrations") });
    const execute = fakeExecute({
      tableExists: true,
      appliedRows: [
        { name: first.name, checksum: first.checksum },
        { name: "0009_gone", checksum: "x" },
      ],
    });
    const stdout = capture();

    await runMigrateStatus({ projectRoot: root, loadConfig, execute, stdout });

    expect(stdout.text).toContain("Applied (1):\n  - 0001_first");
    expect(stdout.text).toContain("Pending (1):\n  - 0002_second");
    expect(stdout.text).toContain("0009_gone: missing");
  });
});
