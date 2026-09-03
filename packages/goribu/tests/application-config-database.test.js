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

  it("enforces the D1 type and name shape with repair instructions", () => {
    expect(() =>
      defineConfig({ ...base, database: { type: "postgres", name: "app" } }),
    ).toThrow(/database\.type must be "d1".*Set type: "d1"/);

    for (const name of ["", "Bad Name", "-app", "a".repeat(64)]) {
      expect(() =>
        defineConfig({ ...base, database: { type: "d1", name } }),
      ).toThrow(/database\.name must be a lowercase D1 database name/);
    }
  });

  it("rejects fields owned by later substeps and unsafe nested shapes", () => {
    expect(() =>
      defineConfig({
        ...base,
        database: { type: "d1", name: "app", replication: true },
      }),
    ).toThrow(/unknown field "replication".*supported D1 fields are type and name/);
    expect(() => defineConfig({ ...base, database: "app" })).toThrow(
      /database must be a plain object/,
    );

    const accessor = { type: "d1" };
    Object.defineProperty(accessor, "name", {
      enumerable: true,
      get: () => "app",
    });
    expect(() => defineConfig({ ...base, database: accessor })).toThrow(
      /database\.name must be an ordinary enumerable value/,
    );

    const symbol = Symbol("database");
    expect(() =>
      defineConfig({
        ...base,
        database: { type: "d1", name: "app", [symbol]: true },
      }),
    ).toThrow(/database cannot contain symbol-keyed fields/);
  });
});
