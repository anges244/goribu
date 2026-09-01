import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeWorkerEntry } from "../src/build/generate-worker-entry.js";

const created = [];

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "goribu-worker-"));
  created.push(root);
  return root;
}

function writeRoute(root, relativePath, source = "export default function Page() { return null; }\n") {
  const filePath = join(root, "src", "routes", relativePath);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, source);
}

afterEach(() => {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("writeWorkerEntry", () => {
  it("generates a Worker that imports each route and hands the manifest to createApp", () => {
    const root = makeProject();
    writeRoute(root, "index.jsx");
    writeRoute(root, "about.jsx");
    writeRoute(root, "posts/[id].jsx");

    const { outputFile, source } = writeWorkerEntry({ projectRoot: root });

    expect(outputFile).toBe(join(root, ".goribu", "worker.js"));
    expect(existsSync(outputFile)).toBe(true);
    expect(readFileSync(outputFile, "utf8")).toBe(source);

    expect(source).toContain('import { createApp } from "goribu/server"');
    expect(source).toContain('import * as module0 from "../src/routes/index.jsx"');
    expect(source).toContain('import * as module2 from "../src/routes/posts/[id].jsx"');
    expect(source).toContain('"pattern": "/posts/:id"');
    expect(source).toContain('["src/routes/index.jsx", module0]');
    expect(source).toContain("const errorPages = { notFound: null };");
    expect(source).toContain("const documentId = null;");
    expect(source).toContain(
      "export default createApp({ manifest, modules, errorPages, documentId });",
    );
    // The absolute file path must never leak into the bundled manifest.
    expect(source).not.toContain(root);
  });

  it("discovers the _404 and _document modules and wires their identities", () => {
    const root = makeProject();
    writeRoute(root, "index.jsx");
    writeRoute(root, "_404.jsx");
    writeRoute(root, "_document.jsx");

    const { source } = writeWorkerEntry({ projectRoot: root });

    expect(source).toContain('import * as module1 from "../src/routes/_404.jsx"');
    expect(source).toContain('import * as module2 from "../src/routes/_document.jsx"');
    expect(source).toContain('const errorPages = { notFound: "src/routes/_404.jsx" };');
    expect(source).toContain('const documentId = "src/routes/_document.jsx";');
  });

  it("imports a route that exports HTTP handlers so the runtime can dispatch them", () => {
    const root = makeProject();
    writeRoute(root, "index.jsx");
    writeRoute(
      root,
      "submit.jsx",
      "export function POST() {}\nexport default function Page() { return null; }\n",
    );

    const { source } = writeWorkerEntry({ projectRoot: root });

    // The handler route is imported like any other module, and its exported
    // methods travel in the manifest so matchRoute can produce a handler match.
    expect(source).toContain('from "../src/routes/submit.jsx"');
    expect(source).toMatch(/"methods":\s*\[\s*"POST"\s*\]/);
  });

  it("fails closed with a teaching error when no routes are found", () => {
    const root = makeProject();
    expect(() => writeWorkerEntry({ projectRoot: root })).toThrow(/no routes were found/);
  });

  it("requires a project root", () => {
    expect(() => writeWorkerEntry({})).toThrow(/requires the application project root/);
  });
});
