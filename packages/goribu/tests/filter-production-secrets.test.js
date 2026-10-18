import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { parse } from "dotenv";
import { filterProductionSecrets } from "../src/build/postgres/filter-production-secrets.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ...Object.fromEntries(
    ["readFileSync", "writeFileSync", "mkdtempSync", "rmSync"].map((name) => [name, vi.fn(actual[name])]),
  ) };
});
const actual = await vi.importActual("node:fs");
const projectRoot = resolve("/app");
const sourcePath = resolve(projectRoot, ".env.production");
let input;
let credentials;

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of ["writeFileSync", "mkdtempSync", "rmSync"]) fs[name].mockImplementation(actual[name]);
  // Simulate the author's file in memory. No unfiltered fixture is written to disk.
  fs.readFileSync.mockImplementation((path, ...args) => path === sourcePath ? input : actual.readFileSync(path, ...args));
  credentials = [randomBytes(24).toString("hex"), randomBytes(24).toString("hex")];
});

afterEach(() => {
  for (const result of fs.mkdtempSync.mock.results) {
    if (result.type === "return") actual.rmSync(result.value, { recursive: true, force: true });
  }
});

function run(secretsFile = ".env.production") {
  return filterProductionSecrets({ projectRoot, secretsFile });
}

function assertFilteredWrites() {
  // Boolean assertions prevent a failure diff from printing input secrets.
  for (const [, contents] of fs.writeFileSync.mock.calls) {
    expect(credentials.some((value) => String(contents).includes(value))).toBe(false);
    expect(String(contents).includes("POSTGRES_URL")).toBe(false);
    expect(String(contents).includes("POSTGRES_MIGRATE_URL")).toBe(false);
  }
}

describe("filterProductionSecrets", () => {
  it("preserves Wrangler's dotenv values, writes only filtered JSON at 0600, and cleans up in finally", () => {
    input = [
      `POSTGRES_URL=${credentials[0]}`, `POSTGRES_MIGRATE_URL=${credentials[1]}`,
      'DOUBLE="double # quoted"', "SINGLE='single # quoted'", "UNQUOTED=before#ignored",
      'MULTILINE="first\nsecond"', 'ESCAPED="first\\nsecond\\rthird"', "export EXPORTED=exported",
      "EMPTY=", 'QUOTED_EMPTY=""', 'LITERAL="${EXPORTED} $HOME"', "COLON: colon value",
      'QUOTES="an \'inner\' quote"', "BACKTICK=`backtick # value`",
    ].join("\n");
    const expected = {
      DOUBLE: "double # quoted", SINGLE: "single # quoted", UNQUOTED: "before",
      MULTILINE: "first\nsecond", ESCAPED: "first\nsecond\rthird", EXPORTED: "exported",
      EMPTY: "", QUOTED_EMPTY: "", LITERAL: "${EXPORTED} $HOME", COLON: "colon value",
      QUOTES: "an 'inner' quote", BACKTICK: "backtick # value",
    };
    const parsed = parse(input);
    delete parsed.POSTGRES_URL;
    delete parsed.POSTGRES_MIGRATE_URL;
    expect(JSON.stringify(parsed) === JSON.stringify(expected)).toBe(true);
    const filtered = run();
    const directory = dirname(filtered.secretsFile);
    try {
      expect(JSON.stringify(JSON.parse(actual.readFileSync(filtered.secretsFile, "utf8"))) === JSON.stringify(expected)).toBe(true);
      expect(actual.statSync(filtered.secretsFile).mode & 0o777).toBe(0o600);
      expect(actual.statSync(directory).mode & 0o777).toBe(0o700);
      expect(actual.readdirSync(directory)).toEqual(["secrets.json"]);
      expect(fs.writeFileSync.mock.calls.length).toBe(1);
      assertFilteredWrites();
    } finally {
      filtered.cleanup();
    }
    expect(actual.existsSync(directory)).toBe(false);
    expect(() => filtered.cleanup()).not.toThrow();
  });

  it("preserves JSON values, including special property names and nulls, without expanding strings", () => {
    const values = {
      POSTGRES_URL: credentials[0], POSTGRES_MIGRATE_URL: credentials[1],
      TOKEN: 'quotes " and # and\nnewlines', EMPTY: "", LITERAL: "${TOKEN}", NULL_VALUE: null,
      ["__proto__"]: "ordinary secret key",
    };
    input = JSON.stringify(values);
    const expected = { ...values };
    delete expected.POSTGRES_URL;
    delete expected.POSTGRES_MIGRATE_URL;
    const filtered = run();
    try {
      const output = JSON.parse(actual.readFileSync(filtered.secretsFile, "utf8"));
      expect(JSON.stringify(output) === JSON.stringify(expected)).toBe(true);
      assertFilteredWrites();
    } finally {
      filtered.cleanup();
    }
  });

  it("returns the exact original path without copying when neither Postgres key is present", () => {
    for (const secretsFile of [".env.production", sourcePath]) {
      input = 'TOKEN="ordinary # value"\nPOSTGRES_URL_EXTRA=keep';
      const filtered = run(secretsFile);
      expect(filtered.secretsFile).toBe(secretsFile);
      filtered.cleanup();
    }
    expect(fs.mkdtempSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.rmSync).not.toHaveBeenCalled();
  });

  it("removes either Postgres key even when its value is empty or null", () => {
    for (const key of ["POSTGRES_URL", "POSTGRES_MIGRATE_URL"]) {
      for (const value of ["", null]) {
        input = JSON.stringify({ [key]: value, KEEP: "same" });
        const filtered = run();
        try {
          expect(JSON.parse(actual.readFileSync(filtered.secretsFile, "utf8"))).toEqual({ KEEP: "same" });
          assertFilteredWrites();
        } finally {
          filtered.cleanup();
        }
      }
    }
  });

  it("returns no file without making a directory when only Postgres keys remain or no file exists", () => {
    for (const contents of [
      `POSTGRES_URL=${credentials[0]}`,
      `POSTGRES_MIGRATE_URL=${credentials[1]}`,
      JSON.stringify({ POSTGRES_URL: credentials[0], POSTGRES_MIGRATE_URL: credentials[1] }),
    ]) {
      input = contents;
      const filtered = run();
      expect(filtered.secretsFile).toBeUndefined();
      filtered.cleanup();
    }
    const reads = fs.readFileSync.mock.calls.length;
    const missing = filterProductionSecrets({ projectRoot, secretsFile: undefined });
    expect(missing.secretsFile).toBeUndefined();
    missing.cleanup();
    expect(fs.readFileSync.mock.calls.length).toBe(reads);
    expect(fs.mkdtempSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("cleans up a partial write before returning a credential-free failure", () => {
    input = `POSTGRES_URL=${credentials[0]}\nKEEP=ordinary`;
    fs.writeFileSync.mockImplementation((...args) => {
      actual.writeFileSync(...args);
      throw new Error(credentials[0]);
    });
    let error;
    try { run(); } catch (caught) { error = caught; }
    expect(error.message).toMatch(/\[Goribu\] Could not write the filtered production secrets file.*free space and permissions.*goribu deploy/);
    expect(error.cause).toBeUndefined();
    expect(error.message.includes(credentials[0])).toBe(false);
    const directory = fs.mkdtempSync.mock.results[0].value;
    expect(actual.existsSync(directory)).toBe(false);
    assertFilteredWrites();
  });

  it("reports read and temporary-directory failures without retaining underlying diagnostics", () => {
    fs.readFileSync.mockImplementationOnce(() => { throw new Error(credentials[0]); });
    let error;
    try { run(); } catch (caught) { error = caught; }
    expect(error.message).toMatch(/\[Goribu\] Could not read .env.production.*readable.*goribu deploy/);
    expect(error.cause).toBeUndefined();
    expect(error.message.includes(credentials[0])).toBe(false);
    input = `POSTGRES_URL=${credentials[0]}\nKEEP=ordinary`;
    fs.mkdtempSync.mockImplementationOnce(() => { throw new Error(credentials[1]); });
    try { run(); } catch (caught) { error = caught; }
    expect(error.message).toMatch(/\[Goribu\] Could not write the filtered production secrets file/);
    expect(error.cause).toBeUndefined();
    expect(error.message.includes(credentials[1])).toBe(false);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("reports cleanup failure safely and lets the caller retry cleanup", () => {
    input = `POSTGRES_URL=${credentials[0]}\nKEEP=ordinary`;
    const filtered = run();
    fs.rmSync.mockImplementationOnce(() => { throw new Error(credentials[0]); });
    let error;
    try { filtered.cleanup(); } catch (caught) { error = caught; }
    expect(error.message).toMatch(/\[Goribu\] Could not remove the temporary production secrets directory.*permissions/);
    expect(error.cause).toBeUndefined();
    expect(error.message.includes(credentials[0])).toBe(false);
    filtered.cleanup();
    expect(actual.existsSync(dirname(filtered.secretsFile))).toBe(false);
  });
});
