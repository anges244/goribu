import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { readMigrations } from "../src/build/migrations/read-migrations.js";
import { runMigrateDown } from "../src/build/migrations/run-migrate-down.js";

let root;
const appConfig = defineConfig({
  name: "app",
  compatibilityDate: "2026-09-03",
  database: { type: "d1", name: "app-db" },
});
const loadConfig = async () => appConfig;
const capture = () => ({ text: "", write(text) { this.text += text; } });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "goribu-migrate-down-"));
  mkdirSync(join(root, "migrations"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function migration(name, down = "DROP TABLE widgets;") {
  writeFileSync(
    join(root, "migrations", `${name}.sql`),
    `-- migrate:up\nCREATE TABLE widgets (name TEXT);\n-- migrate:down\n${down}\n`,
  );
  return readMigrations({ migrationsDir: join(root, "migrations") }).find(
    (entry) => entry.name === name,
  );
}

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

describe("runMigrateDown", () => {
  it("rolls back only the last applied migration and deletes its ledger row in the same batch", async () => {
    const first = migration("0001_first", "DROP TABLE first_table;");
    const second = migration("0002_second", "DROP TABLE second_table;");
    const execute = fakeExecute([
      { name: first.name, checksum: first.checksum },
      { name: second.name, checksum: second.checksum },
    ]);
    const stdout = capture();

    await runMigrateDown({
      projectRoot: root,
      target: "remote",
      loadConfig,
      execute,
      stdout,
    });

    expect(execute.files).toHaveLength(1);
    expect(execute.files[0]).toContain("DROP TABLE second_table;");
    expect(execute.files[0]).not.toContain("DROP TABLE first_table;");
    expect(execute.files[0]).toContain(
      "DELETE FROM _goribu_migrations WHERE name = '0002_second';",
    );
    expect(execute.calls.every((call) => call.target === "remote")).toBe(true);
    expect(stdout.text).toContain("✓ Rolled back 0002_second from remote");
  });

  it("refuses an empty down section without deleting its ledger row", async () => {
    const applied = migration("0001_irreversible", "");
    const execute = fakeExecute([{ name: applied.name, checksum: applied.checksum }]);

    await expect(
      runMigrateDown({ projectRoot: root, loadConfig, execute, stdout: capture() }),
    ).rejects.toThrow(/declared no rollback.*write a new forward migration/s);
    expect(execute.files).toHaveLength(0);
  });

  it("refuses to mutate while migration history has drifted", async () => {
    migration("0001_first");
    const execute = fakeExecute([{ name: "0001_first", checksum: "stale-checksum" }]);

    await expect(
      runMigrateDown({ projectRoot: root, loadConfig, execute, stdout: capture() }),
    ).rejects.toThrow(/history has drifted/);
    expect(execute.files).toHaveLength(0);
  });

  it("reports cleanly when no migration is applied", async () => {
    migration("0001_first");
    const execute = fakeExecute();
    const stdout = capture();

    await runMigrateDown({ projectRoot: root, loadConfig, execute, stdout });

    expect(execute.files).toHaveLength(0);
    expect(stdout.text).toBe("Nothing to roll back on local (0 applied).\n");
  });
});
