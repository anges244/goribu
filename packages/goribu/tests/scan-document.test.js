import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanDocument } from "../src/routing/scan-document.js";

const created = [];

function makeRoutesDir() {
  const root = mkdtempSync(join(tmpdir(), "goribu-document-"));
  created.push(root);
  const routesDir = join(root, "routes");
  mkdirSync(routesDir, { recursive: true });
  return routesDir;
}

afterEach(() => {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("scanDocument", () => {
  it("returns null when no _document exists", () => {
    expect(scanDocument(makeRoutesDir())).toBeNull();
  });

  it("returns null when the routes directory is missing", () => {
    expect(scanDocument(join(tmpdir(), "goribu-does-not-exist-xyz", "routes"))).toBeNull();
  });

  it("discovers a top-level _document module", () => {
    const routesDir = makeRoutesDir();
    const filePath = join(routesDir, "_document.jsx");
    writeFileSync(filePath, "export default function Document() { return null; }\n");
    expect(scanDocument(routesDir)).toBe(filePath);
  });

  it("ignores a _document nested below the top level", () => {
    const routesDir = makeRoutesDir();
    mkdirSync(join(routesDir, "blog"), { recursive: true });
    writeFileSync(join(routesDir, "blog", "_document.jsx"), "export default 1;\n");
    expect(scanDocument(routesDir)).toBeNull();
  });

  it("fails closed when two _document modules disagree on extension", () => {
    const routesDir = makeRoutesDir();
    writeFileSync(join(routesDir, "_document.js"), "export default 1;\n");
    writeFileSync(join(routesDir, "_document.jsx"), "export default 1;\n");
    expect(() => scanDocument(routesDir)).toThrow(/Multiple _document modules/);
  });
});
