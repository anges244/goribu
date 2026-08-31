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

afterEach(() => {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("writeWorkerEntry", () => {
  it("generates .goribu/worker.js that streams the hardcoded page", () => {
    const root = makeProject();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "page.jsx"), "export default function Page() { return null; }\n");

    const { outputFile, source } = writeWorkerEntry({ projectRoot: root });

    expect(outputFile).toBe(join(root, ".goribu", "worker.js"));
    expect(existsSync(outputFile)).toBe(true);
    expect(readFileSync(outputFile, "utf8")).toBe(source);
    expect(source).toContain('import { renderToReadableStream } from "react-dom/server.edge"');
    expect(source).toContain('import Page from "../src/page.jsx"');
    expect(source).toContain("renderToReadableStream(");
  });

  it("fails closed with a teaching error when the page is missing", () => {
    const root = makeProject();
    expect(() => writeWorkerEntry({ projectRoot: root })).toThrow(/page\.jsx.*is missing/);
  });

  it("fails closed when src/page.jsx is a directory, not a file", () => {
    const root = makeProject();
    mkdirSync(join(root, "src", "page.jsx"), { recursive: true });
    expect(() => writeWorkerEntry({ projectRoot: root })).toThrow(/is not a regular file/);
  });

  it("requires a project root", () => {
    expect(() => writeWorkerEntry({})).toThrow(/requires the application project root/);
  });
});
