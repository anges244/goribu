import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
const cli = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));

describe.skipIf(!process.env.GORIBU_TEST_POSTGRES_URL)(
  "Postgres migration CLI (set GORIBU_TEST_POSTGRES_URL to run)",
  () => {
    it("scaffolds, reports pending, applies, reports applied, and reports up to date", async () => {
      const admin = postgres(process.env.GORIBU_TEST_POSTGRES_URL, { max: 1, onnotice() {} });
      const database = `goribu_migrate_${randomBytes(8).toString("hex")}`;
      let created = false;
      let root;
      try {
        await admin`CREATE DATABASE ${admin(database)}`;
        created = true;
        root = mkdtempSync(join(tmpdir(), "goribu-postgres-migrate-cli-"));
        cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
        for (const name of ["package.json", "goribu.config.js", "vite.config.js"]) {
          cpSync(join(fixture, name), join(root, name));
        }
        symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
        const configPath = join(root, "goribu.config.js");
        writeFileSync(configPath, readFileSync(configPath, "utf8").replace("defineConfig({", 'defineConfig({\n  database: { type: "postgres" },'));
        const url = new URL(process.env.GORIBU_TEST_POSTGRES_URL);
        url.pathname = `/${database}`;
        writeFileSync(join(root, ".env"), `POSTGRES_URL=${JSON.stringify(url.href)}\n`);

        function run(...args) {
          const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", timeout: 30000 });
          expect(result.error).toBeUndefined();
          expect(result.status, result.stderr).toBe(0);
          return result.stdout;
        }
        expect(run("migrate:new", "create posts")).toBe("✓ Created migrations/0001_create-posts.sql\n");
        const migration = join(root, "migrations/0001_create-posts.sql");
        writeFileSync(migration, readFileSync(migration, "utf8").replace("-- migrate:up\n", "-- migrate:up\nCREATE TABLE posts (id int primary key);\n"));
        expect(run("migrate:status", "--local")).toContain("Pending (1):\n  - 0001_create-posts");
        expect(run("migrate")).toBe("✓ Applied 0001_create-posts to local\n");
        expect(run("migrate:status")).toContain("Applied (1):\n  - 0001_create-posts\n\nPending (0):\n  none");
        expect(run("migrate", "--local")).toBe("Already up to date on local (1 applied).\n");
      } finally {
        const errors = [];
        for (const cleanup of [
          () => { if (root) rmSync(root, { recursive: true, force: true }); },
          async () => { if (created) await admin`DROP DATABASE IF EXISTS ${admin(database)} WITH (FORCE)`; },
          () => admin.end({ timeout: 5 }),
        ]) {
          try { await cleanup(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, "Postgres CLI integration cleanup failed");
      }
    }, 60000);
  },
);
