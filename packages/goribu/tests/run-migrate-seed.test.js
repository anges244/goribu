import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { runMigrateSeed } from "../src/build/migrations/run-migrate-seed.js";

let root;
const appConfig = defineConfig({
  name: "app",
  compatibilityDate: "2026-09-03",
  database: { type: "d1", name: "app-db" },
});
const loadConfig = async () => appConfig;
const capture = () => ({ text: "", write(text) { this.text += text; } });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "goribu-migrate-seed-"));
  mkdirSync(join(root, "migrations"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runMigrateSeed", () => {
  it("runs migrations/seed.sql against local D1", async () => {
    const seedFile = join(root, "migrations", "seed.sql");
    writeFileSync(seedFile, "INSERT INTO widgets (name) VALUES ('seeded');\n");
    const execute = vi.fn(async () => undefined);
    const stdout = capture();

    await runMigrateSeed({ projectRoot: root, loadConfig, execute, stdout });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ file: seedFile, target: "local" }),
    );
    expect(stdout.text).toBe("✓ Ran migrations/seed.sql on local\n");
  });

  it("teaches how to repair a missing seed file", async () => {
    const execute = vi.fn(async () => undefined);

    await expect(
      runMigrateSeed({ projectRoot: root, loadConfig, execute, stdout: capture() }),
    ).rejects.toThrow(/No seed file exists at migrations\/seed\.sql.*Create migrations\/seed\.sql/s);
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses --remote before loading config or running SQL", async () => {
    const guardedLoadConfig = vi.fn(loadConfig);
    const execute = vi.fn(async () => undefined);

    await expect(
      runMigrateSeed({
        projectRoot: root,
        target: "remote",
        loadConfig: guardedLoadConfig,
        execute,
        stdout: capture(),
      }),
    ).rejects.toThrow(/never runs against production/);
    expect(guardedLoadConfig).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not inspect or mutate the migration ledger", async () => {
    writeFileSync(join(root, "migrations", "seed.sql"), "SELECT 1;\n");
    const calls = [];
    const execute = async (options) => {
      calls.push(options);
    };

    await runMigrateSeed({ projectRoot: root, loadConfig, execute, stdout: capture() });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBeUndefined();
    expect(calls[0].file).toBe(join(root, "migrations", "seed.sql"));
  });
});
