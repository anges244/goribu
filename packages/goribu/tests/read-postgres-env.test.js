import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readPostgresEnv } from "../src/build/postgres/read-postgres-env.js";

const appUrl = "postgres://app:secret@localhost:5432/app";
const migrateUrl = "postgres://owner:secret@localhost:5432/app";
const overrideUrl = "postgres://other:secret@localhost:5433/app";
const created = [];

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "goribu-postgres-env-"));
  created.push(root);
  return root;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("readPostgresEnv", () => {
  it("merges local files per key, tracks the winner, and returns only frozen URL entries", () => {
    const projectRoot = makeProject();
    writeFileSync(join(projectRoot, ".env"), `POSTGRES_URL=${appUrl}\nPOSTGRES_MIGRATE_URL=${migrateUrl}\nOTHER_SECRET=discard\n`);
    writeFileSync(join(projectRoot, ".env.local"), `POSTGRES_URL=${overrideUrl}\n`);
    const result = readPostgresEnv({ projectRoot, target: "local" });
    expect(result).toEqual({
      url: { value: overrideUrl, source: "POSTGRES_URL in .env.local" },
      migrateUrl: { value: migrateUrl, source: "POSTGRES_MIGRATE_URL in .env" },
    });
    expect([result, result.url, result.migrateUrl].every(Object.isFrozen)).toBe(true);

    writeFileSync(join(projectRoot, ".env.local"), `POSTGRES_MIGRATE_URL=${overrideUrl}\n`);
    expect(readPostgresEnv({ projectRoot, target: "local" })).toEqual({
      url: { value: appUrl, source: "POSTGRES_URL in .env" },
      migrateUrl: { value: overrideUrl, source: "POSTGRES_MIGRATE_URL in .env.local" },
    });
  });

  it("reads only .dev.vars when it exists, hiding .env and .env.local completely", () => {
    const projectRoot = makeProject();
    writeFileSync(join(projectRoot, ".dev.vars"), `POSTGRES_URL=${appUrl}\n`);
    writeFileSync(join(projectRoot, ".env"), `POSTGRES_MIGRATE_URL=${migrateUrl}\n`);
    mkdirSync(join(projectRoot, ".env.local"));
    expect(readPostgresEnv({ projectRoot, target: "local" })).toEqual({
      url: { value: appUrl, source: "POSTGRES_URL in .dev.vars" },
      migrateUrl: undefined,
    });
  });

  it("reads production from .env.production alone", () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, ".dev.vars"));
    writeFileSync(join(projectRoot, ".env"), `POSTGRES_URL=${overrideUrl}\nPOSTGRES_MIGRATE_URL=${migrateUrl}\n`);
    writeFileSync(join(projectRoot, ".env.production"), `POSTGRES_URL=${appUrl}\n`);
    expect(readPostgresEnv({ projectRoot, target: "production" })).toEqual({
      url: { value: appUrl, source: "POSTGRES_URL in .env.production" },
      migrateUrl: undefined,
    });
  });

  it("accepts production JSON and requires strings for the two selected keys", () => {
    const projectRoot = makeProject();
    const filename = join(projectRoot, ".env.production");
    const values = { POSTGRES_URL: appUrl, POSTGRES_MIGRATE_URL: migrateUrl, OTHER_SECRET: { ignored: true } };
    writeFileSync(filename, JSON.stringify(values));
    expect(readPostgresEnv({ projectRoot, target: "production" })).toEqual({
      url: { value: appUrl, source: "POSTGRES_URL in .env.production" },
      migrateUrl: { value: migrateUrl, source: "POSTGRES_MIGRATE_URL in .env.production" },
    });
    for (const key of ["POSTGRES_URL", "POSTGRES_MIGRATE_URL"]) {
      writeFileSync(filename, JSON.stringify({ ...values, [key]: { secret: "never-echo-this" } }));
      expect(() => readPostgresEnv({ projectRoot, target: "production" })).toThrow(
        `[Goribu] ${key} in .env.production must be a string. Set it to a PostgreSQL connection URL such as postgres://user:password@host:5432/database.`,
      );
    }
  });

  it("reads dollar signs and variable references literally in every env format", () => {
    vi.stubEnv("PASSWORD", "expanded-value");
    const literalUrl = 'postgres://app:pa$$${PASSWORD}@localhost:5432/app?option=$UNCHANGED';
    for (const filename of [".dev.vars", ".env", ".env.local", ".env.production"]) {
      const projectRoot = makeProject();
      writeFileSync(join(projectRoot, filename), `POSTGRES_URL=${literalUrl}\nPOSTGRES_MIGRATE_URL=${literalUrl}\n`);
      expect(readPostgresEnv({ projectRoot, target: filename === ".env.production" ? "production" : "local" }))
        .toEqual({
          url: { value: literalUrl, source: `POSTGRES_URL in ${filename}` },
          migrateUrl: { value: literalUrl, source: `POSTGRES_MIGRATE_URL in ${filename}` },
        });
    }
  });

  it("explains each missing input without falling back to local or process values", () => {
    vi.stubEnv("POSTGRES_URL", appUrl);
    for (const [target, files, message] of [
      ["local", {}, /POSTGRES_URL is missing from .env and .env.local.*Add it to .env \(create that file if needed\)/],
      ["local", { ".env": "OTHER=unused\n" }, /POSTGRES_URL is missing from .env and .env.local.*.env.local to override .env/],
      ["local", { ".env.local": "OTHER=unused\n" }, /POSTGRES_URL is missing from .env and .env.local.*Add it to .env/],
      ["local", { ".dev.vars": "", ".env": `POSTGRES_URL=${appUrl}\n` }, /POSTGRES_URL is missing from .dev.vars.*only when .dev.vars does not exist; add it to .dev.vars or remove that file/],
      ["production", { ".env": `POSTGRES_URL=${appUrl}\n` }, /.env.production does not exist.*Create .env.production and add POSTGRES_URL.*direct \(non-pooled\)/],
      ["production", { ".env.production": "OTHER=unused\n", ".env": `POSTGRES_URL=${appUrl}\n` }, /POSTGRES_URL is missing from .env.production.*Add your provider's direct \(non-pooled\) connection string/],
    ]) {
      const projectRoot = makeProject();
      for (const [filename, contents] of Object.entries(files)) writeFileSync(join(projectRoot, filename), contents);
      expect(() => readPostgresEnv({ projectRoot, target })).toThrow(message);
    }
  });

  it("rejects invalid and empty URLs with their winning source and without exposing values", () => {
    const projectRoot = makeProject();
    writeFileSync(join(projectRoot, ".env"), `POSTGRES_URL=${appUrl}\n`);
    writeFileSync(join(projectRoot, ".env.local"), "POSTGRES_URL=postgres://app:never-echo-this@localhost\n");
    expect(() => readPostgresEnv({ projectRoot, target: "local" })).toThrow(
      "[Goribu] POSTGRES_URL in .env.local is not a usable PostgreSQL connection URL. Include exactly one database name after the host, percent-encoding a slash inside the name as %2F.",
    );
    writeFileSync(join(projectRoot, ".env.local"), "POSTGRES_MIGRATE_URL=\n");
    expect(() => readPostgresEnv({ projectRoot, target: "local" })).toThrow(
      "[Goribu] POSTGRES_MIGRATE_URL in .env.local is not a usable PostgreSQL connection URL. Set it to postgres://user:password@host:5432/database.",
    );
  });

  it("fails closed with the read cause for unreadable files and dangling symlinks", () => {
    for (const filename of [".dev.vars", ".env.local", ".env.production"]) {
      const projectRoot = makeProject();
      writeFileSync(join(projectRoot, ".env"), `POSTGRES_URL=${appUrl}\n`);
      if (filename === ".env.production") symlinkSync("missing-env-file", join(projectRoot, filename));
      else mkdirSync(join(projectRoot, filename));
      expect(() => readPostgresEnv({ projectRoot, target: filename === ".env.production" ? "production" : "local" }))
        .toThrow(expect.objectContaining({
          message: `[Goribu] Could not read ${filename}. Make the file and its directory readable, then retry the command.`,
          cause: expect.objectContaining({ code: filename === ".env.production" ? "ENOENT" : "EISDIR" }),
        }));
    }
  });
});

it("pins the reader's parity with Wrangler's dotenv for URL-relevant syntax", () => {
  // Target Wrangler's bundled dotenv parser; recheck parity when upgrading Wrangler.
  const projectRoot = makeProject();
  const filename = join(projectRoot, ".env.production");
  const read = () => readPostgresEnv({ projectRoot, target: "production" });
  for (const [contents, expected] of [
    [`POSTGRES_URL='${appUrl}'`, appUrl],
    [`POSTGRES_URL="${appUrl}"`, appUrl],
    [`POSTGRES_URL: ${appUrl}`, appUrl],
    [`POSTGRES_URL=${appUrl}#comment`, appUrl],
    [`POSTGRES_URL=${appUrl} # comment`, appUrl],
    [`export POSTGRES_URL=${appUrl}`, appUrl],
    [`OTHER=unused\r\nPOSTGRES_URL=${appUrl}\r\n`, appUrl],
    [`POSTGRES_URL=${appUrl}\nPOSTGRES_URL=${overrideUrl}`, overrideUrl],
  ]) {
    writeFileSync(filename, contents);
    expect(read().url).toEqual({ value: expected, source: "POSTGRES_URL in .env.production" });
  }
  writeFileSync(filename, `POSTGRES_URL="${appUrl}#kept"`);
  expect(read).toThrow(/POSTGRES_URL in .env.production.*Remove the URL fragment/);

  writeFileSync(filename, "POSTGRES_URL=postgres://app:p#ss@localhost/app");
  expect(read).toThrow(/In env files, wrap the value in double quotes if it contains #; an unquoted # starts a comment/);

  writeFileSync(filename, "POSTGRES_URL=");
  expect(read).toThrow(/POSTGRES_URL in .env.production.*Set it to postgres:/);
});
