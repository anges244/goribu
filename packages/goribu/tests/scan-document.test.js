import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanDocument } from "../src/routing/scan-document.js";

const created = [];

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "goribu-document-"));
  created.push(root);
  const setupDir = join(root, "src/setup");
  mkdirSync(setupDir, { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("scanDocument", () => {
  it("rejects legacy Documents even when a setup Document also exists", () => {
    for (const extension of ["js", "jsx", "ts", "tsx"]) {
      const root = makeProject();
      mkdirSync(join(root, "src/routes"));
      const legacy = join(root, `src/routes/_document.${extension}`);
      writeFileSync(legacy, "export default 1;\n");
      expect(() => scanDocument(root)).toThrow(/Move it to src\/setup\/_document/);
      const current = join(root, `src/setup/_document.${extension}`);
      writeFileSync(current, "export default 1;\n");
      expect(() => scanDocument(root)).toThrow(/Keep only the setup copy/);
      rmSync(legacy);
      expect(scanDocument(root)).toBe(current);
    }
  });

  it("returns null when no _document exists", () => {
    expect(scanDocument(makeProject())).toBeNull();
  });

  it("returns null when the setup directory is missing", () => {
    expect(scanDocument(join(tmpdir(), "goribu-does-not-exist-xyz"))).toBeNull();
  });

  it("discovers a top-level _document module", () => {
    const root = makeProject();
    const setupDir = join(root, "src/setup");
    const filePath = join(setupDir, "_document.jsx");
    writeFileSync(filePath, "export default function Document() { return null; }\n");
    expect(scanDocument(root)).toBe(filePath);
  });

  it("ignores a _document nested below the top level", () => {
    const root = makeProject();
    const setupDir = join(root, "src/setup");
    mkdirSync(join(setupDir, "blog"), { recursive: true });
    writeFileSync(join(setupDir, "blog", "_document.jsx"), "export default 1;\n");
    expect(scanDocument(root)).toBeNull();
  });

  it("fails closed when two _document modules disagree on extension", () => {
    const root = makeProject();
    const setupDir = join(root, "src/setup");
    writeFileSync(join(setupDir, "_document.js"), "export default 1;\n");
    writeFileSync(join(setupDir, "_document.jsx"), "export default 1;\n");
    expect(() => scanDocument(root)).toThrow(/Multiple _document modules/);
  });
});
