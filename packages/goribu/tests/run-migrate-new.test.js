import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrateNew } from "../src/build/migrations/run-migrate-new.js";
import { readMigrations } from "../src/build/migrations/read-migrations.js";

let root;
const stdout = { lines: [], write(text) { this.lines.push(text); } };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "goribu-migrate-new-"));
  stdout.lines = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runMigrateNew", () => {
  it("scaffolds 0001 with empty, marker-bearing sections", () => {
    const { name, file } = runMigrateNew({ projectRoot: root, name: "Create Feedback", stdout });

    expect(name).toBe("0001_create-feedback");
    const parsed = readMigrations({ migrationsDir: join(root, "migrations") });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ name, upSql: "", downSql: "" });
    expect(readFileSync(file, "utf8")).toContain("-- migrate:up");
    expect(stdout.lines.join("")).toContain("migrations/0001_create-feedback.sql");
  });

  it("increments the sequence past the highest existing migration", () => {
    mkdirSync(join(root, "migrations"), { recursive: true });
    writeFileSync(
      join(root, "migrations", "0007_prior.sql"),
      "-- migrate:up\n-- migrate:down\n",
    );

    const { name } = runMigrateNew({ projectRoot: root, name: "next-thing", stdout });
    expect(name).toBe("0008_next-thing");
  });

  it("rejects a name with no usable slug", () => {
    expect(() => runMigrateNew({ projectRoot: root, name: "***", stdout })).toThrow(
      /requires a descriptive name/,
    );
  });
});
