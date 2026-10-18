import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { runPostgresMigrate } from "../src/build/postgres/run-postgres-migrate.js";
import * as migrationDatabase from "../src/build/postgres/connect-migration-database.js";

const config = defineConfig({ name: "app", compatibilityDate: "2026-09-03", database: { type: "postgres" } });
const loadConfig = async () => config;
let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "goribu-postgres-migrate-"));
  mkdirSync(join(root, "migrations"));
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("runPostgresMigrate preflight", () => {
  it("reads .env.production for --remote and never falls back to .env", async () => {
    writeFileSync(join(root, ".env"), "POSTGRES_URL=postgres://u:p@127.0.0.1:1/db\n");
    await expect(runPostgresMigrate({ projectRoot: root, target: "remote", loadConfig })).rejects.toThrow(/\.env\.production does not exist/);
  });

  it("refuses an empty scaffold before connecting", async () => {
    writeFileSync(join(root, ".env"), "POSTGRES_URL=postgres://u:p@127.0.0.1:1/db\n");
    writeFileSync(join(root, "migrations/0001_empty.sql"), "-- migrate:up\n-- migrate:down\n");
    await expect(runPostgresMigrate({ projectRoot: root, loadConfig })).rejects.toThrow(/has no SQL under -- migrate:up/);
  });

  it("does not label a transport failure as a Postgres error", async () => {
    writeFileSync(join(root, "migrations/0001_posts.sql"), "-- migrate:up\nCREATE TABLE posts (id int);\n-- migrate:down\n");
    const cause = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    const sql = (strings) => typeof strings === "string"
      ? strings
      : strings[0].includes("pg_try_advisory_lock") ? [{ locked: true }] : [];
    sql.unsafe = async (query) => { if (query.startsWith("CREATE TABLE posts")) throw cause; };
    sql.begin = async (callback) => callback(sql);
    sql.end = vi.fn();
    const connect = vi.spyOn(migrationDatabase, "connectMigrationDatabase").mockResolvedValue(sql);
    try {
      await expect(runPostgresMigrate({ projectRoot: root, loadConfig })).rejects.toMatchObject({
        cause,
        message: "[Goribu] Migration 0001_posts failed on local: connection reset. It ran in a transaction, so none of its changes and no ledger row were kept. Fix migrations/0001_posts.sql and run the command again.",
      });
      expect(sql.end).toHaveBeenCalledWith({ timeout: 5 });
    } finally {
      connect.mockRestore();
    }
  });
});
