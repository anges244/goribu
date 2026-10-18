import { describe, expect, it } from "vitest";
import { defineConfig } from "goribu/server";

const base = { name: "app", compatibilityDate: "2026-09-03" };

describe("defineConfig database", () => {
  it("accepts and freezes one D1 database declaration", () => {
    const source = { type: "d1", name: "my-app_db" };
    const config = defineConfig({ ...base, database: source });

    expect(config.database).toEqual(source);
    expect(config.database).not.toBe(source);
    expect(Object.isFrozen(config.database)).toBe(true);
  });

  it("enforces the database type and D1 name shape with repair instructions", () => {
    for (const type of [undefined, "mysql", null]) {
      expect(() =>
        defineConfig({ ...base, database: { type, name: "app" } }),
      ).toThrow(/database\.type must be "d1" or "postgres".*Set type:/);
    }

    for (const name of ["", "Bad Name", "-app", "a".repeat(64)]) {
      expect(() =>
        defineConfig({ ...base, database: { type: "d1", name } }),
      ).toThrow(/database\.name must be a lowercase D1 database name/);
    }
  });

  it("accepts and freezes Postgres declarations with automatic or paired Hyperdrive IDs", () => {
    for (const source of [
      { type: "postgres" },
      { type: "postgres", hyperdriveId: "direct-id", hyperdriveCachedId: "cached-id" },
    ]) {
      const config = defineConfig({ ...base, database: source });
      expect(config.database).toEqual(source);
      expect(config.database).not.toBe(source);
      expect(Object.isFrozen(config.database)).toBe(true);
      source.hyperdriveId = "changed";
      expect(config.database.hyperdriveId).not.toBe("changed");
    }
  });

  it("requires non-empty Hyperdrive IDs supplied together", () => {
    for (const field of ["hyperdriveId", "hyperdriveCachedId"]) {
      for (const value of ["", "  ", null, 42, false]) {
        expect(() => defineConfig({ ...base, database: {
          type: "postgres", hyperdriveId: "direct-id", hyperdriveCachedId: "cached-id",
          [field]: value,
        } })).toThrow(new RegExp(`database\\.${field} must be a non-empty string`));
      }
      expect(() => defineConfig({ ...base, database: {
        type: "postgres", [field]: "id",
      } })).toThrow(/hyperdriveId and database\.hyperdriveCachedId together.*Supply both/);
    }
  });

  it("requires different configs for the two caching modes", () => {
    expect(() => defineConfig({ ...base, database: {
      type: "postgres", hyperdriveId: "same-id", hyperdriveCachedId: "same-id",
    } })).toThrow(/must name different Hyperdrive configs.*one caching disabled, one enabled/);
  });

  it("shows both database shapes for unknown or misplaced fields", () => {
    for (const database of [
      { type: "postgres", name: "app" },
      { type: "postgres", replication: true },
      { type: "postgres", placement: "smart" },
      { type: "d1", name: "app", url: "secret" },
      { type: "d1", name: "app", migrateUrl: "secret" },
      { type: "d1", name: "app", hyperdriveId: "id" },
    ]) {
      expect(() => defineConfig({ ...base, database }))
        .toThrow(/unknown field.*type: "d1".*type: "postgres"/);
    }
  });

  it("keeps connection strings out of config and diagnostics", () => {
    for (const [field, envKey] of [["url", "POSTGRES_URL"], ["migrateUrl", "POSTGRES_MIGRATE_URL"]]) {
      expect(() => defineConfig({ ...base, database: {
        type: "postgres", [field]: "postgres://user:secret@host/app",
      } })).toThrow(
        `[Goribu] Application configuration field database.${field} is unsupported. Put ${envKey} in .env / .env.production; connection strings never go in goribu.config.js.`,
      );
    }
  });

  it("rejects unsafe database shapes without invoking getters", () => {
    for (const database of [null, [], Object.create(null), "postgres"]) {
      expect(() => defineConfig({ ...base, database }))
        .toThrow(/database must be a plain object.*type: "d1".*type: "postgres"/);
    }
    expect(() => defineConfig({ ...base, database: {
      type: "postgres", [Symbol("id")]: "id",
    } })).toThrow(/symbol-keyed fields.*type: "d1".*type: "postgres"/);

    for (const field of ["type", "name", "replication", "hyperdriveId", "hyperdriveCachedId"]) {
      for (const descriptor of [
        { enumerable: true, get() { throw new Error("getter ran"); } },
        { enumerable: false, value: "id" },
      ]) {
        const database = Object.defineProperty({ type: "postgres" }, field, descriptor);
        expect(() => defineConfig({ ...base, database }))
          .toThrow(new RegExp(`database\\.${field} must be an ordinary enumerable value`));
      }
    }
  });
});
