import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readR2Uploads } from "../src/build/read-r2-uploads.js";
import { builtAt, writeUploadBuild } from "./fixtures/r2-upload-build.js";

const appConfig = { name: "test-app", r2: { name: "app-files" } };
const roots = [];
function setup() {
  const projectRoot = mkdtempSync(join(tmpdir(), "goribu-r2-inventory-"));
  roots.push(projectRoot);
  return { projectRoot, appConfig };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("read-only built upload inventory", () => {
  it("returns missing without a build, reads the build time, and never changes output", () => {
    const options = setup();
    expect(readR2Uploads(options)).toBeNull();
    expect(() => readR2Uploads({ ...options, required: true })).toThrow("Run `goribu build` first");
    const path = writeUploadBuild(options.projectRoot, appConfig, { video: { accept: ["video/*"], maxBytes: 1_000_000_000, direct: true, private: false } });
    const before = readFileSync(path, "utf8");
    expect(readR2Uploads(options)).toMatchObject({ builtAt, routes: [{ fields: { video: { direct: true } } }] });
    expect(readFileSync(path, "utf8")).toBe(before);
    rmSync(path);
    expect(readR2Uploads(options)).toBeNull();
  });

  it("rejects corrupt, foreign, or ambiguous output instead of skipping its checks", () => {
    const options = setup();
    const path = writeUploadBuild(options.projectRoot, appConfig);
    for (const text of ["not JSON", "null", JSON.stringify({ version: 2, routes: [] }), JSON.stringify({ version: 1, builtAt: "bad", routes: [] }),
      JSON.stringify({ version: 1, routes: [{ id: "x", pattern: "/", fields: { file: { accept: ["image/*"], maxBytes: 10, private: false } } }] })]) {
      writeFileSync(path, text);
      expect(() => readR2Uploads(options)).toThrow("Could not verify the build's R2 upload metadata");
    }
    writeUploadBuild(options.projectRoot, { name: "other-app" });
    expect(() => readR2Uploads(options)).toThrow("Run `goribu build` first");
    writeFileSync(join(options.projectRoot, ".wrangler/deploy/config.json"), "null");
    expect(() => readR2Uploads(options)).toThrow("Run `goribu build` first");
  });

  it("refuses redirect escapes and a metadata symlink without revealing its target", () => {
    const options = setup();
    const path = writeUploadBuild(options.projectRoot, appConfig);
    const target = join(options.projectRoot, ".env.production");
    writeFileSync(target, "TEST_SECRET=synthetic-value-must-not-appear");
    rmSync(path);
    symlinkSync(target, path);
    expect(() => readR2Uploads(options)).toThrow("Could not verify");
    writeFileSync(join(options.projectRoot, ".wrangler/deploy/config.json"), JSON.stringify({ configPath: "../../../outside.json" }));
    expect(() => readR2Uploads(options)).toThrow("Could not verify");
  });
});
