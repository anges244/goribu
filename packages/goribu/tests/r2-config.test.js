import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineConfig } from "goribu/server";
import { assertNoDuplicateR2Declaration } from "../src/build/assert-no-duplicate-r2.js";
import { writeWranglerConfig } from "../src/build/generate-wrangler-config.js";

const base = { name: "app", compatibilityDate: "2026-09-01" };
const roots = [];
function project() {
  const root = mkdtempSync(join(tmpdir(), "goribu-r2-config-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("R2 configuration", () => {
  it("snapshots and freezes both buckets, normalizes the hostname, and accepts single-bucket shapes", () => {
    const r2 = { name: "app-media", domain: "Media.Example.com", private: { name: "app-files" }, jurisdiction: "eu" };
    const config = defineConfig({ ...base, r2 });
    r2.name = "changed";
    r2.private.name = "changed";
    expect(config.r2).toEqual({ name: "app-media", domain: "media.example.com", private: { name: "app-files" }, jurisdiction: "eu" });
    expect(Object.isFrozen(config.r2)).toBe(true);
    expect(Object.isFrozen(config.r2.private)).toBe(true);
    expect(defineConfig(config)).toBe(config);
    for (const name of ["abc", "0-1", "a".repeat(63)]) {
      expect(defineConfig({ ...base, r2: { name } }).r2).toEqual({ name });
      expect(defineConfig({ ...base, r2: { name, domain: "media.example.com" } }).r2.private).toBeUndefined();
    }
    expect(defineConfig(base).r2).toBeUndefined();
  });

  it("rejects invalid names in either bucket with the exact field and repair", () => {
    for (const name of [undefined, null, 42, "", "ab", "a".repeat(64), "App", "a_b", "-abc", "abc-", "abc/def", "abc\n"]) {
      expect(() => defineConfig({ ...base, r2: { name } }), String(name)).toThrow(/\[Goribu\].*r2.name.*3 to 63.*goribu.config.js/);
      expect(() => defineConfig({ ...base, r2: { name: "app-media", domain: "media.example.com", private: { name } } }))
        .toThrow(/\[Goribu\].*r2.private.name.*3 to 63/);
    }
  });

  it("rejects URL syntax, malformed hostnames, and managed r2.dev hosts", () => {
    for (const domain of [null, 42, "", "media", "localhost", "https://media.example.com", "media.example.com/", "media.example.com:443", "user@media.example.com", "media.example.com?q=x", "media.example.com#x", "media.example.com\\x", " media.example.com", "media.example.com\n", "*.example.com", "-media.example.com", "media_.example.com", "media..example.com", "media.example.com.", "a".repeat(64) + ".com", ["a".repeat(63), "a".repeat(63), "a".repeat(63), "a".repeat(63)].join("."), "127.0.0.1", "[::1]"]) {
      expect(() => defineConfig({ ...base, r2: { name: "app-media", domain } }), String(domain))
        .toThrow(/\[Goribu\].*r2.domain.*bare hostname with at least two labels.*custom hostname/);
    }
    for (const domain of ["r2.dev", "bucket.r2.dev", "BUCKET.R2.DEV", "nested.bucket.r2.dev"]) {
      expect(() => defineConfig({ ...base, r2: { name: "app-media", domain } }))
        .toThrow(/\[Goribu\].*r2.domain cannot use an r2.dev host.*custom hostname/);
    }
    expect(defineConfig({ ...base, r2: { name: "app-media", domain: "example.com" } }).r2.domain).toBe("example.com");
  });

  it("requires a public default bucket, distinct names, and the supported jurisdiction", () => {
    expect(() => defineConfig({ ...base, r2: { name: "app-files", private: { name: "other-files" } } }))
      .toThrow(/r2.private requires r2.domain/);
    expect(() => defineConfig({ ...base, r2: { name: "app-media", domain: "media.example.com", private: { name: "app-media" } } }))
      .toThrow(/r2.private.name must differ from r2.name/);
    for (const jurisdiction of [null, "", "default", "EU", "us", 1]) {
      expect(() => defineConfig({ ...base, r2: { name: "app-files", jurisdiction } }))
        .toThrow(/r2.jurisdiction must be "eu" or omitted/);
    }
  });

  it("rejects unknown fields and non-data objects without evaluating accessors", () => {
    const unexpectedRead = () => { throw new Error("accessor was evaluated"); };
    for (const [field, value, message] of [
      ["r2", { name: "app-media", binding: "OTHER" }, /r2.binding.*supported fields.*name, domain, private, jurisdiction/],
      ["private", { name: "app-files", domain: "private.example.com" }, /r2.private.domain.*supported fields.*name/],
    ]) {
      const r2 = field === "r2" ? value : { name: "app-media", domain: "media.example.com", private: value };
      expect(() => defineConfig({ ...base, r2 })).toThrow(message);
    }
    for (const invalid of [null, [], "bucket", Object.create(null), Object.create({ name: "inherited" }), { name: "app-files", [Symbol()]: true }, JSON.parse('{"name":"app-files","__proto__":{}}')]) {
      expect(() => defineConfig({ ...base, r2: invalid })).toThrow(/\[Goribu\].*r2/);
      expect(() => defineConfig({ ...base, r2: { name: "app-media", domain: "media.example.com", private: invalid } }))
        .toThrow(/\[Goribu\].*r2.private/);
    }
    for (const field of ["name", "domain", "private", "jurisdiction"]) {
      for (const descriptor of [{ get: unexpectedRead, enumerable: true }, { value: "hidden", enumerable: false }]) {
        const r2 = Object.defineProperty({ name: "app-media" }, field, descriptor);
        expect(() => defineConfig({ ...base, r2 })).toThrow(/ordinary enumerable value/);
      }
    }
    const privateBucket = Object.defineProperty({}, "name", { get: unexpectedRead, enumerable: true });
    expect(() => defineConfig({ ...base, r2: { name: "app-media", domain: "media.example.com", private: privateBucket } }))
      .toThrow(/r2.private.name must be an ordinary enumerable value/);
  });

  it("synthesizes only the configured bindings with jurisdiction on both and preserves D1/KV", () => {
    const projectRoot = project();
    for (const jurisdiction of [undefined, "eu"]) {
      for (const privateBucket of [undefined, { name: "app-files" }]) {
        const appConfig = defineConfig({ ...base,
          database: { type: "d1", name: "app-db" }, kv: { name: "app-kv" },
          r2: { name: "app-media", domain: "media.example.com", private: privateBucket, jurisdiction },
        });
        const { config, outputFile } = writeWranglerConfig({ projectRoot, appConfig });
        const location = jurisdiction === undefined ? {} : { jurisdiction };
        expect(config.r2_buckets).toEqual([
          { binding: "R2", bucket_name: "app-media", ...location },
          ...(privateBucket ? [{ binding: "R2_PRIVATE", bucket_name: "app-files", ...location }] : []),
        ]);
        expect(config.d1_databases[0]).toMatchObject({ binding: "DB", database_name: "app-db" });
        expect(config.kv_namespaces).toEqual([{ binding: "KV", preview_id: "app-kv" }]);
        expect(JSON.parse(readFileSync(outputFile, "utf8").replace(/^\/\/[^\n]*\n/, ""))).toEqual(config);
      }
    }
    expect(writeWranglerConfig({ projectRoot, appConfig: defineConfig(base) }).config).not.toHaveProperty("r2_buckets");
  });

  it("rejects competing root and environment declarations in all Wrangler formats and fails closed on parse errors", async () => {
    const projectRoot = project();
    const appConfig = defineConfig({ ...base, r2: { name: "app-files" } });
    for (const [filename, source] of [
      ["wrangler.json", '{"r2_buckets":[]}'],
      ["wrangler.jsonc", '{/* author config */ "env":{"production":{"r2_buckets":[{"binding":"OTHER","bucket_name":"other-bucket"}]}}}'],
      ["wrangler.toml", '[[r2_buckets]]\nbinding = "R2"\nbucket_name = "app-files"'],
      ["wrangler.toml", '[[env.production.r2_buckets]]\nbinding = "R2_PRIVATE"\nbucket_name = "app-files"'],
    ]) {
      const path = join(projectRoot, filename);
      writeFileSync(path, source);
      await expect(assertNoDuplicateR2Declaration({ projectRoot, appConfig })).rejects.toThrow(/Remove the r2_buckets declaration.*at most two managed buckets/);
      rmSync(path);
    }
    const path = join(projectRoot, "wrangler.json");
    writeFileSync(path, "broken");
    await expect(assertNoDuplicateR2Declaration({ projectRoot, appConfig })).rejects.toThrow(/Could not inspect wrangler.json.*Fix or remove/);
    await expect(assertNoDuplicateR2Declaration({ projectRoot, appConfig: defineConfig(base) })).resolves.toBeUndefined();
    writeFileSync(path, '{"vars":{"A":"b"}}');
    await expect(assertNoDuplicateR2Declaration({ projectRoot, appConfig })).resolves.toBeUndefined();
  });
});
