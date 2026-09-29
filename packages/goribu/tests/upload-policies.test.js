import { describe, expect, it, vi } from "vitest";
import { collectUploadPolicies } from "../src/r2/upload-policies.js";
import { analyzeRouteModule } from "../src/routing/analyze-route-module.js";

const route = { id: "src/routes/profile.jsx", pattern: "/profile", methods: ["POST"] };
const r2 = { name: "media", domain: "media.example.com", private: { name: "files" } };
const policy = { accept: ["image/png", "image/*"], maxBytes: 5_000_000 };
function collect(uploads, config = r2) {
  return collectUploadPolicies([route], new Map([[route.id, { uploads, POST() {} }]]), config);
}

it("keeps keys on the server and publishes only the client allowlist", () => {
  const key = vi.fn(() => "never called during inspection");
  const input = { avatar: { ...policy, accept: [...policy.accept], private: true, direct: true, key } };
  const result = collect(input);
  expect(result.policies.get(route.id).avatar.key).toBe(key);
  expect(key).not.toHaveBeenCalled();
  expect(result.client.get(route.id)).toEqual({ avatar: policy });
  expect(result.summary).toEqual([{ id: route.id, pattern: route.pattern, fields: {
    avatar: { ...policy, private: true, direct: true },
  } }]);
  input.avatar.accept.push("text/html");
  expect(result.client.get(route.id).avatar.accept).toEqual(policy.accept.slice(0, 2));
  expect(Object.hasOwn(result.policies.get(route.id), "__proto__")).toBe(false);
});

describe("policy failures teach the route author", () => {
  it.each([
    [{ ...policy, maxBytes: 0 }, /positive integer/],
    [{ ...policy, maxBytes: 1.5 }, /positive integer/],
    [{ ...policy, maxBytes: 5_000_000_001, direct: true }, /5,000,000,000/],
    [{ ...policy, maxBytes: 100_000_001 }, /Add direct: true/],
    [{ ...policy, accept: ["*/*"] }, /MIME types/],
    [{ ...policy, accept: [] }, /non-empty array/],
    [{ ...policy, accept: ["image/png; charset=utf-8"] }, /MIME types/],
    [{ ...policy, private: "yes" }, /private must be true or false/],
    [{ ...policy, direct: 1 }, /direct must be true or false/],
    [{ ...policy, key: "fixed" }, /key must be a function/],
    [{ ...policy, typo: true }, /unknown option/],
  ])("rejects an invalid field %#", (value, reason) => {
    expect(() => collect({ avatar: value })).toThrow(reason);
    expect(() => collect({ avatar: value })).toThrow('[Goribu] Route "src/routes/profile.jsx" uploads.avatar');
  });

  it("requires configured buckets and a callable ref handler", () => {
    expect(() => collectUploadPolicies([route], new Map([[route.id, { uploads: {} }]]))).toThrow(/Configure r2/);
    expect(() => collect({ avatar: { ...policy, private: true } }, { name: "files" })).toThrow(/Configure r2.private/);
    expect(() => collectUploadPolicies([route], new Map([[route.id, { uploads: {} }]]), r2)).toThrow(/POST, PUT or PATCH/);
    expect(() => collect({ large: { ...policy, maxBytes: 5_000_000_000, direct: true } })).not.toThrow();
  });

  it("rejects getters and unsafe object shapes without evaluating accessors", () => {
    const getter = vi.fn(() => "image/png");
    const accept = ["image/png"];
    Object.defineProperty(accept, 0, { get: getter });
    for (const value of [
      { get avatar() { return getter(); } },
      { avatar: { ...policy, get key() { return getter(); } } },
      { avatar: { ...policy, accept } },
      { avatar: { ...policy, [Symbol("field")]: true } },
      JSON.parse('{"__proto__": {}}'),
      new Date(),
    ]) expect(() => collect(value)).toThrow(/\[Goribu\]/);
    expect(getter).not.toHaveBeenCalled();
  });
});

it("requires a receiving handler for direct, aliased and re-exported uploads", () => {
  for (const source of [
    "export const uploads = {};",
    "const policies = {}; export { policies as uploads };",
    'export { uploads } from "../policies.js";',
  ]) {
    expect(() => analyzeRouteModule(source, route.id)).toThrow(/POST, PUT or PATCH/);
    for (const method of ["POST", "PUT", "PATCH"]) {
      expect(() => analyzeRouteModule(`${source} export function ${method}() {}`, route.id)).not.toThrow();
    }
  }
  expect(() => analyzeRouteModule("export type uploads = {}; export default function Page() {}", "page.ts")).not.toThrow();
});

it("reports definite absence separately from wildcard export uncertainty", () => {
  expect(analyzeRouteModule('export function POST() {}', 'action.js').hasUploads).toBe(false);
  expect(analyzeRouteModule('export * from "./policy.js"; export function POST() {}', 'action.js').hasUploads).toBeNull();
  expect(analyzeRouteModule('import * as policies from "./policies.js"; export import uploads = policies.uploads; export function POST() {}', 'action.ts').hasUploads).toBeNull();
  expect(analyzeRouteModule('export type * from "./types.js"; export function POST() {}', 'action.ts').hasUploads).toBe(false);
  expect(analyzeRouteModule('export namespace uploads { export const avatar = {}; } export function POST() {}', 'action.ts').hasUploads).toBe(true);
});
