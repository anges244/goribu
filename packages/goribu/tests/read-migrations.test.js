import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMigrations } from "../src/build/migrations/read-migrations.js";

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "goribu-read-migrations-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name, contents) {
  writeFileSync(join(dir, name), contents);
}

const BODY = "-- migrate:up\nCREATE TABLE t (a);\n-- migrate:down\nDROP TABLE t;\n";

describe("readMigrations", () => {
  it("reports a first-line transaction opt-out without including it in forward SQL", () => {
    write("0001_default.sql", BODY);
    write("0002_add-index.sql", `-- goribu:no-transaction\n${BODY}`);
    const [normal, optedOut] = readMigrations({ migrationsDir: dir });
    expect(normal.transaction).toBe(true);
    expect(optedOut.transaction).toBe(false);
    expect(optedOut.upSql).toBe(normal.upSql);
    expect(optedOut.upSql).not.toContain("goribu:no-transaction");
    expect(optedOut.checksum).not.toBe(normal.checksum);
  });

  it.each([
    [`-- add-index\n-- goribu:no-transaction\n${BODY}`, 2],
    ["-- migrate:up\n-- goribu:no-transaction\nSELECT 1;\n-- migrate:down\n", 2],
    [`-- goribu:no-transactions\n${BODY}`, 1],
    [`-- Goribu:No-Transaction\n${BODY}`, 1],
  ])("rejects unrecognized or misplaced directives (%#)", (contents, line) => {
    write("0003_add-index.sql", contents);
    expect(() => readMigrations({ migrationsDir: dir })).toThrow(
      new RegExp(`misplaced Goribu directive on line ${line}`),
    );
  });

  it("returns an empty list when the directory does not exist", () => {
    expect(readMigrations({ migrationsDir: join(dir, "missing") })).toEqual([]);
  });

  it("parses and orders migrations, ignoring seed.sql and non-sql files", () => {
    write("0002_second.sql", "-- migrate:up\nSELECT 2;\n-- migrate:down\n");
    write("0001_first.sql", BODY);
    write("seed.sql", "INSERT INTO t VALUES (9);");
    write("README.md", "notes");

    const migrations = readMigrations({ migrationsDir: dir });

    expect(migrations.map((m) => m.name)).toEqual(["0001_first", "0002_second"]);
    expect(migrations[0]).toMatchObject({
      sequence: 1,
      upSql: "CREATE TABLE t (a);",
      downSql: "DROP TABLE t;",
    });
    expect(migrations[0].checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(migrations[1].downSql).toBe("");
  });

  it("makes the checksum ignore CRLF but not content", () => {
    write("0001_first.sql", BODY);
    const lf = readMigrations({ migrationsDir: dir })[0].checksum;
    write("0001_first.sql", BODY.replace(/\n/g, "\r\n"));
    const crlf = readMigrations({ migrationsDir: dir })[0].checksum;
    write("0001_first.sql", BODY.replace("(a)", "(a, b)"));
    const changed = readMigrations({ migrationsDir: dir })[0].checksum;

    expect(crlf).toBe(lf);
    expect(changed).not.toBe(lf);
  });

  it("rejects a filename that is not a four-digit sequence and slug", () => {
    write("1_first.sql", BODY);
    expect(() => readMigrations({ migrationsDir: dir })).toThrow(
      /does not match the required name.*0001_create-feedback\.sql/s,
    );
  });

  it("rejects two migrations sharing one sequence", () => {
    write("0001_first.sql", BODY);
    write("0001_other.sql", BODY);
    expect(() => readMigrations({ migrationsDir: dir })).toThrow(
      /sequence 0001 is used by both/,
    );
  });

  it.each([
    ["-- migrate:down\nDROP TABLE t;\n-- migrate:up\nCREATE TABLE t (a);\n", /down before -- migrate:up/],
    ["-- migrate:up\nCREATE TABLE t (a);\n", /no "-- migrate:down" marker/],
    ["CREATE TABLE t (a);\n-- migrate:down\n", /no "-- migrate:up" marker/],
    ["-- migrate:up\n-- migrate:up\n-- migrate:down\n", /more than once "-- migrate:up"/],
  ])("rejects malformed section markers (%#)", (contents, message) => {
    write("0001_first.sql", contents);
    expect(() => readMigrations({ migrationsDir: dir })).toThrow(message);
  });
});
