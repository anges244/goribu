import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { runPostgresMigrate } from "../src/build/postgres/run-postgres-migrate.js";
import { runPostgresMigrateStatus } from "../src/build/postgres/run-postgres-migrate-status.js";

const config = defineConfig({ name: "app", compatibilityDate: "2026-09-03", database: { type: "postgres" } });
const loadConfig = async () => config;
const capture = () => ({ text: "", write(text) { this.text += text; } });

describe.skipIf(!process.env.GORIBU_TEST_POSTGRES_URL)(
  "Postgres migrations against a real database (set GORIBU_TEST_POSTGRES_URL to run)",
  () => {
    let admin;
    let sql;
    let database;
    let databaseCreated;
    let root;
    let url;

    beforeAll(() => {
      admin = postgres(process.env.GORIBU_TEST_POSTGRES_URL, { max: 1, onnotice() {} });
    });
    afterAll(async () => { await admin?.end({ timeout: 5 }); });

    beforeEach(async () => {
      database = `goribu_migrate_${randomBytes(8).toString("hex")}`;
      databaseCreated = false;
      root = undefined;
      sql = undefined;
      await admin`CREATE DATABASE ${admin(database)}`;
      databaseCreated = true;
      const parsed = new URL(process.env.GORIBU_TEST_POSTGRES_URL);
      parsed.pathname = `/${database}`;
      url = parsed.href;
      root = mkdtempSync(join(tmpdir(), "goribu-postgres-migrate-integration-"));
      mkdirSync(join(root, "migrations"));
      writeEnv(url);
      sql = postgres(url, { max: 1, onnotice() {} });
    }, 30000);

    afterEach(async () => {
      const errors = [];
      for (const cleanup of [
        () => sql?.end({ timeout: 5 }),
        () => { if (root) rmSync(root, { recursive: true, force: true }); },
        async () => { if (databaseCreated) await admin`DROP DATABASE IF EXISTS ${admin(database)} WITH (FORCE)`; },
      ]) {
        try { await cleanup(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, "Postgres migration integration cleanup failed");
    }, 30000);

    function writeEnv(value, migrateUrl) {
      writeFileSync(join(root, ".env"), `POSTGRES_URL=${JSON.stringify(value)}\n` +
        (migrateUrl === undefined ? "" : `POSTGRES_MIGRATE_URL=${JSON.stringify(migrateUrl)}\n`));
    }
    function migration(name, up, directive = false) {
      writeFileSync(join(root, "migrations", `${name}.sql`),
        `${directive ? "-- goribu:no-transaction\n" : ""}-- migrate:up\n${up}\n-- migrate:down\n`);
    }
    function migrate(stdout = capture()) {
      return runPostgresMigrate({ projectRoot: root, loadConfig, stdout });
    }
    function status(stdout = capture()) {
      return runPostgresMigrateStatus({ projectRoot: root, loadConfig, stdout });
    }

    it("applies files in order, reports up to date, and lists the applied ledger", async () => {
      migration("0001_tables", "CREATE TABLE posts (id int); CREATE TABLE tags (id int);");
      migration("0002_title", "ALTER TABLE posts ADD COLUMN title text;");
      const stdout = capture();
      await migrate(stdout);
      expect(stdout.text).toBe("✓ Applied 0001_tables to local\n✓ Applied 0002_title to local\n");
      const rows = await sql`SELECT name, applied_at, pg_typeof(applied_at)::text AS type FROM _goribu_migrations ORDER BY name`;
      expect(rows.map((row) => row.name)).toEqual(["0001_tables", "0002_title"]);
      expect(rows.every((row) => row.applied_at instanceof Date && row.type === "timestamp with time zone")).toBe(true);
      const again = capture();
      await migrate(again);
      expect(again.text).toBe("Already up to date on local (2 applied).\n");
      const report = capture();
      await status(report);
      expect(report.text).toBe("Goribu migrations — local\n\nApplied (2):\n  - 0001_tables\n  - 0002_title\n\nPending (0):\n  none\n");
    });

    it("rolls back a failed file and applies it after repair", async () => {
      migration("0001_posts", "CREATE TABLE posts (id int);");
      migration("0002_broken", "CREATE TABLE ok_then_fail (x int); SELEC 1;");
      await expect(migrate()).rejects.toThrow(/Migration 0002_\S+ failed on local: .*\(Postgres 42601\)\. It ran in a transaction/);
      expect(await sql`SELECT name FROM _goribu_migrations ORDER BY name`).toEqual([{ name: "0001_posts" }]);
      expect((await sql`SELECT to_regclass('ok_then_fail') AS name`)[0].name).toBeNull();
      migration("0002_broken", "CREATE TABLE ok_then_fail (x int);");
      const result = await migrate();
      expect(result.pending.map((row) => row.name)).toEqual(["0002_broken"]);
      expect(await sql`SELECT name FROM _goribu_migrations ORDER BY name`).toEqual([{ name: "0001_posts" }, { name: "0002_broken" }]);
    });

    it("refuses drift before applying another file and reports it through status", async () => {
      migration("0001_posts", "CREATE TABLE posts (id int);");
      await migrate();
      migration("0001_posts", "CREATE TABLE posts (id bigint);");
      migration("0002_tags", "CREATE TABLE tags (id int);");
      await expect(migrate()).rejects.toThrow(/history has drifted/);
      expect(await sql`SELECT name FROM _goribu_migrations`).toEqual([{ name: "0001_posts" }]);
      expect((await sql`SELECT to_regclass('tags') AS name`)[0].name).toBeNull();
      const report = capture();
      await status(report);
      expect(report.text).toContain("0001_posts: modified");
    });

    it("serializes concurrent migration runs on the database", async () => {
      migration("0001_posts", "SELECT pg_sleep(0.5); CREATE TABLE posts (id int);");
      const first = capture();
      const second = capture();
      await Promise.all([migrate(first), migrate(second)]);
      expect(await sql`SELECT name FROM _goribu_migrations`).toEqual([{ name: "0001_posts" }]);
      const outputs = [first.text, second.text];
      expect(outputs.filter((text) => text.includes("✓ Applied"))).toHaveLength(1);
      expect(outputs.filter((text) => text.includes("Already up to date on local (1 applied)."))).toHaveLength(1);
    });

    it("requires a no-transaction migration to hold one concurrent index statement", async () => {
      migration("0001_posts", "CREATE TABLE posts (id int);");
      const index = "CREATE INDEX CONCURRENTLY posts_id_idx ON posts (id);";
      migration("0002_index", index);
      let transactionError;
      try { await migrate(); } catch (error) { transactionError = error; }
      expect(transactionError?.cause?.code).toBe("25001");
      expect(transactionError?.message).toContain("own migration whose first line is -- goribu:no-transaction");
      migration("0002_index", `${index} CREATE INDEX CONCURRENTLY posts_other_idx ON posts (id);`, true);
      await expect(migrate()).rejects.toThrow(/must contain exactly one statement/);
      migration("0002_index", index, true);
      await migrate();
      const [{ indisvalid }] = await sql`SELECT indisvalid FROM pg_index WHERE indexrelid = 'posts_id_idx'::regclass`;
      expect(indisvalid).toBe(true);
      expect(await sql`SELECT name FROM _goribu_migrations ORDER BY name`).toEqual([{ name: "0001_posts" }, { name: "0002_index" }]);
    });

    it("reports pending files without creating a ledger", async () => {
      migration("0001_posts", "CREATE TABLE posts (id int);");
      migration("0002_tags", "CREATE TABLE tags (id int);");
      const report = capture();
      await status(report);
      expect(report.text).toContain("Pending (2):\n  - 0001_posts\n  - 0002_tags");
      expect((await sql`SELECT to_regclass('_goribu_migrations') AS name`)[0].name).toBeNull();
    });

    it("prefers the migration URL and reports connection failures without a password", async () => {
      migration("0001_posts", "CREATE TABLE posts (id int);");
      const wrong = new URL(url);
      wrong.password = "wrong-s3cret";
      writeEnv(wrong.href, url);
      await migrate();
      writeEnv(wrong.href);
      let failure;
      try { await migrate(); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).toMatch(/Could not connect to Postgres at localhost:5432\/goribu_migrate_\w+ using POSTGRES_URL in \.env: password authentication failed/);
      expect(failure.message.includes("wrong-s3cret")).toBe(false);
    });
  },
);
