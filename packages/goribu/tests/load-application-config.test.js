import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadApplicationConfig } from "../src/build/load-application-config.js";

const APPLICATION_CONFIG_URL = new URL(
  "../src/runtime/application-config.js",
  import.meta.url,
).href;

const created = [];

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "goribu-load-config-"));
  created.push(root);
  return root;
}

function writeConfigFile(root, body) {
  writeFileSync(join(root, "goribu.config.js"), body);
}

afterEach(() => {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("loadApplicationConfig", () => {
  it("loads a branded config from goribu.config.js", async () => {
    const root = makeProject();
    writeConfigFile(
      root,
      `import { defineConfig } from ${JSON.stringify(APPLICATION_CONFIG_URL)};\n` +
        'export default defineConfig({ name: "loaded-app", compatibilityDate: "2026-08-31" });\n',
    );

    const config = await loadApplicationConfig({ projectRoot: root });

    expect(config.name).toBe("loaded-app");
    expect(config.compatibilityDate).toBe("2026-08-31");
  });

  it("fails closed with a teaching error when goribu.config.js is missing", async () => {
    const root = makeProject();
    await expect(loadApplicationConfig({ projectRoot: root })).rejects.toThrow(
      /goribu\.config\.js.*is missing/,
    );
  });

  it("fails closed when goribu.config.js is a directory, not a file", async () => {
    const root = makeProject();
    mkdirSync(join(root, "goribu.config.js"));
    await expect(loadApplicationConfig({ projectRoot: root })).rejects.toThrow(
      /is not a regular file/,
    );
  });

  it("fails closed when the default export is not a defineConfig result", async () => {
    const root = makeProject();
    writeConfigFile(root, 'export default { name: "loaded-app", compatibilityDate: "2026-08-31" };\n');
    await expect(loadApplicationConfig({ projectRoot: root })).rejects.toThrow(
      /must default-export the result of defineConfig/,
    );
  });

  it("requires a project root", async () => {
    await expect(loadApplicationConfig({})).rejects.toThrow(
      /requires the application project root/,
    );
  });
});
