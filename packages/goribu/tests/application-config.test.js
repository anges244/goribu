import { describe, expect, it } from "vitest";
import { defineConfig } from "goribu/server";
import { isApplicationConfig } from "../src/runtime/application-config.js";

describe("defineConfig", () => {
  it("accepts a full config and returns a frozen, branded snapshot", () => {
    const config = defineConfig({
      name: "goribu-basic-app",
      compatibilityDate: "2026-08-31",
      compatibilityFlags: ["nodejs_compat"],
    });

    expect(config).toEqual({
      name: "goribu-basic-app",
      compatibilityDate: "2026-08-31",
      compatibilityFlags: ["nodejs_compat"],
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.compatibilityFlags)).toBe(true);
    // Re-branding an already-branded config returns it unchanged.
    expect(defineConfig(config)).toBe(config);
  });

  it("defaults compatibilityFlags to an empty frozen array when omitted", () => {
    const config = defineConfig({ name: "app", compatibilityDate: "2024-01-01" });
    expect(config.compatibilityFlags).toEqual([]);
    expect(Object.isFrozen(config.compatibilityFlags)).toBe(true);
  });

  it("normalizes one optional application hostname without changing the supplied config", () => {
    const base = { name: "app", compatibilityDate: "2024-01-01" };
    expect(defineConfig(base).domain).toBeUndefined();
    for (const domain of ["Example.COM", "App.Example.COM"]) {
      const input = { ...base, domain };
      const config = defineConfig(input);
      expect(config.domain).toBe(domain.toLowerCase());
      expect(input.domain).toBe(domain);
      expect(Object.isFrozen(config)).toBe(true);
    }
  });

  it("rejects malformed application hostnames and Cloudflare-managed addresses", () => {
    const base = { name: "app", compatibilityDate: "2024-01-01" };
    for (const domain of [null, 42, ["app.example.com"], "", "localhost", "https://app.example.com", "app.example.com/", "app.example.com:443", "user@app.example.com", "app.example.com?q=x", "app.example.com#x", "app.example.com\\x", " app.example.com", "app.example.com\n", "*.example.com", "-app.example.com", "app_.example.com", "app..example.com", "app.example.com.", "a".repeat(64) + ".com", ["a".repeat(63), "a".repeat(63), "a".repeat(63), "a".repeat(63)].join("."), "127.0.0.1", "[::1]"]) {
      expect(() => defineConfig({ ...base, domain }), String(domain))
        .toThrow(/\[Goribu\].*field domain.*bare hostname.*custom hostname/);
    }
    for (const domain of ["workers.dev", "app.account.workers.dev", "APP.ACCOUNT.WORKERS.DEV", "r2.dev", "bucket.r2.dev"]) {
      expect(() => defineConfig({ ...base, domain }))
        .toThrow(/\[Goribu\].*field domain cannot use Cloudflare-managed .* hosts.*custom hostname/);
    }
  });

  it("requires separate application and R2 hostnames after normalization", () => {
    const base = { name: "app", compatibilityDate: "2024-01-01", domain: "App.Example.COM" };
    expect(() => defineConfig({ ...base, r2: { name: "app-media", domain: "app.example.com" } }))
      .toThrow(/\[Goribu\].*domain must differ from r2.domain.*separate hostnames/);
    expect(defineConfig({ ...base, r2: { name: "app-media", domain: "Media.Example.COM" } }).r2.domain)
      .toBe("media.example.com");
    expect(defineConfig({ ...base, r2: { name: "app-files" } }).domain).toBe("app.example.com");
  });

  it("accepts only a callback-shaped responseHeaders policy", () => {
    const responseHeaders = () => ({ "x-frame-options": "DENY" });
    expect(
      defineConfig({
        name: "app",
        compatibilityDate: "2024-01-01",
        responseHeaders,
      }).responseHeaders,
    ).toBe(responseHeaders);

    expect(() =>
      defineConfig({
        name: "app",
        compatibilityDate: "2024-01-01",
        responseHeaders: { "x-frame-options": "DENY" },
      }),
    ).toThrow(/responseHeaders callback/);
  });

  it("accepts and freezes the three-state D1 replication declaration", () => {
    for (const replication of [undefined, true, false]) {
      const database = defineConfig({
        name: "app",
        compatibilityDate: "2024-01-01",
        database: {
          type: "d1",
          name: "app-db",
          ...(replication === undefined ? {} : { replication }),
        },
      }).database;

      expect(database.replication).toBe(replication);
      expect(Object.isFrozen(database)).toBe(true);
    }

    expect(() =>
      defineConfig({
        name: "app",
        compatibilityDate: "2024-01-01",
        database: { type: "d1", name: "app-db", replication: "auto" },
      }),
    ).toThrow(/replication must be true, false, or omitted/);
  });

  it("rejects names that are not valid Cloudflare Worker names", () => {
    for (const name of ["MyApp", "app-", "-app", "under_score", ""]) {
      expect(() =>
        defineConfig({ name, compatibilityDate: "2024-01-01" }),
      ).toThrow(/name must be a Cloudflare Worker name/);
    }
  });

  it("requires a real calendar date for compatibilityDate", () => {
    // A real leap day is accepted.
    expect(
      defineConfig({ name: "app", compatibilityDate: "2024-02-29" }).compatibilityDate,
    ).toBe("2024-02-29");

    for (const compatibilityDate of ["2023-02-29", "2024-13-40", "2024/01/01", "2024-1-1", undefined]) {
      expect(() => defineConfig({ name: "app", compatibilityDate })).toThrow(
        /compatibilityDate must be a real calendar date/,
      );
    }
  });

  it("rejects unknown fields and non-plain configuration objects", () => {
    expect(() =>
      defineConfig({ name: "app", compatibilityDate: "2024-01-01", extra: {} }),
    ).toThrow(/unknown field "extra"/);
    expect(() => defineConfig([])).toThrow(/requires a plain application configuration object/);
    expect(() => defineConfig(null)).toThrow(/requires a plain application configuration object/);
  });

  it("rejects a Document field and points to _document.jsx", () => {
    expect(() =>
      defineConfig({ name: "app", compatibilityDate: "2024-01-01", Document: () => null }),
    ).toThrow(/Document belongs in src\/setup\/_document\.jsx/);
  });

  it("rejects getter-backed configuration fields", () => {
    const hostile = Object.defineProperty({ compatibilityDate: "2024-01-01" }, "name", {
      enumerable: true,
      get: () => "app",
    });
    expect(() => defineConfig(hostile)).toThrow(/must be an ordinary enumerable value/);
  });

  describe("compatibilityFlags cannot be bypassed", () => {
    const base = { name: "app", compatibilityDate: "2024-01-01" };

    it("rejects a non-array and empty-string elements", () => {
      expect(() =>
        defineConfig({ ...base, compatibilityFlags: "nodejs_compat" }),
      ).toThrow(/must be an array of non-empty strings/);
      expect(() =>
        defineConfig({ ...base, compatibilityFlags: [""] }),
      ).toThrow(/must be an array of non-empty strings/);
    });

    it("rejects sparse holes", () => {
      expect(() =>
        defineConfig({ ...base, compatibilityFlags: new Array(1) }),
      ).toThrow(/dense array of non-empty strings/);
    });

    it("rejects accessor-backed elements", () => {
      const flags = [];
      Object.defineProperty(flags, 0, { enumerable: true, get: () => "nodejs_compat" });
      expect(() =>
        defineConfig({ ...base, compatibilityFlags: flags }),
      ).toThrow(/dense array of non-empty strings/);
    });

    it("stores the real indexed values, ignoring a custom Symbol.iterator", () => {
      const flags = ["nodejs_compat"];
      flags[Symbol.iterator] = function* () {
        yield 42;
      };
      const config = defineConfig({ ...base, compatibilityFlags: flags });
      expect(config.compatibilityFlags).toEqual(["nodejs_compat"]);
      expect(config.compatibilityFlags.every((flag) => typeof flag === "string")).toBe(true);
    });
  });

  describe("isApplicationConfig", () => {
    it("recognizes a defineConfig result and rejects everything else", () => {
      const config = defineConfig({ name: "app", compatibilityDate: "2026-08-31" });
      expect(isApplicationConfig(config)).toBe(true);
      expect(isApplicationConfig({ name: "app", compatibilityDate: "2026-08-31" })).toBe(false);
      expect(isApplicationConfig(null)).toBe(false);
      expect(isApplicationConfig("app")).toBe(false);
    });
  });
});
