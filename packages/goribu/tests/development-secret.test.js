import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { getDevelopmentSecret } from "../src/build/development-secret.js";

const roots = [];
function project() {
  const root = mkdtempSync(join(tmpdir(), "goribu-dev-secret-"));
  roots.push(root);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("persists 32 random bytes with private permissions without touching app env files", () => {
  const root = project();
  const env = join(root, ".env");
  writeFileSync(env, "APP_VALUE=test-only\n");
  const secret = getDevelopmentSecret(root);
  expect(Buffer.from(secret, "base64url").length).toBe(32);
  expect(getDevelopmentSecret(root) === secret).toBe(true);
  const file = join(root, ".goribu/dev-secret");
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(readFileSync(env, "utf8")).toBe("APP_VALUE=test-only\n");
});

it("refuses corrupt state and symlinks without reading or overwriting another file", () => {
  const root = project();
  mkdirSync(join(root, ".goribu"));
  const file = join(root, ".goribu/dev-secret");
  writeFileSync(file, "invalid-test-secret");
  expect(() => getDevelopmentSecret(root)).toThrow(/\[Goribu\].*Remove only .goribu\/dev-secret/);
  expect(readFileSync(file, "utf8")).toBe("invalid-test-secret");
  rmSync(file);
  const outside = join(project(), "app-secret");
  writeFileSync(outside, "x".repeat(43));
  symlinkSync(outside, file);
  expect(() => getDevelopmentSecret(root)).toThrow(/\[Goribu\].*regular file/);
  expect(readFileSync(outside, "utf8")).toBe("x".repeat(43));
});
