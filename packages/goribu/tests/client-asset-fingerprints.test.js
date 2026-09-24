import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { build } from "vite";
import { goribu } from "goribu/vite";

const roots = [];
const configModule = new URL("../src/runtime/application-config.js", import.meta.url).href;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function buildAssets({ source = "asset probe 2246", fileName, entryFileNames, assetFileNames, hook = "buildStart", namingPlugin, namingFirst = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "goribu-fingerprints-"));
  roots.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/entry.js"), 'console.log("fingerprint regression");');
  mkdirSync(join(root, "src/setup"));
  writeFileSync(join(root, "src/setup/client-entry.js"), 'import "goribu/client";');
  mkdirSync(join(root, "src/routes"));
  writeFileSync(join(root, "src/routes/index.jsx"), 'export default function Page() { return null; }');
  writeFileSync(join(root, "goribu.config.js"),
    `import { defineConfig } from ${JSON.stringify(configModule)};\n` +
    'export default defineConfig({ name: "fingerprint-test", compatibilityDate: "2026-09-24" });');
  const core = goribu().find((plugin) => plugin?.name === "goribu");
  const configured = await core.config({ root }, { command: "build" });
  const result = await build({
    root, configFile: false, logLevel: "silent",
    plugins: [
      namingFirst && namingPlugin,
      // Exercise Goribu's real output hooks with Vite, without starting a Worker.
      { name: core.name, writeBundle: core.writeBundle },
      !namingFirst && namingPlugin,
      {
        name: "emit-test-asset",
        [hook]: {
          order: "post",
          handler() { this.emitFile({ type: "asset", name: "probe.txt", fileName, source }); },
        },
      },
    ],
    build: {
      sourcemap: true,
      rollupOptions: {
        input: join(root, "src/entry.js"),
        output: {
          plugins: configured.environments.client.build.rollupOptions.output.plugins,
          entryFileNames: entryFileNames ?? "_goribu/assets/[name]-[hash].js",
          assetFileNames: assetFileNames ?? "_goribu/assets/[name]-[hash][extname]",
        },
      },
    },
  });
  return { root, files: result.output.map((file) => file.fileName) };
}

it("accepts a real lowercase asset hash, changes its URL with its content, and adds no audit files", async () => {
  const first = await buildAssets({ hook: "generateBundle" });
  const asset = first.files.find((name) => name.endsWith(".txt"));
  expect(asset).toMatch(/\/probe-[a-z]{8}\.txt$/);
  expect(first.files).toHaveLength(3); // entry, its sourcemap, and the emitted asset
  expect(readdirSync(join(first.root, "dist/_goribu/assets")).sort())
    .toEqual(first.files.map((name) => name.split("/").at(-1)).sort());

  const second = await buildAssets({ source: "changed asset bytes" });
  expect(second.files.find((name) => name.endsWith(".txt"))).not.toBe(asset);
});

it("uses the final naming option regardless of outputOptions hook ordering", async () => {
  for (const { naming, order } of [
    { naming: "_goribu/assets/image-[hash][extname]" },
    { order: "post", naming: (asset) => `_goribu/assets/image-[hash]${asset.names[0].endsWith(".txt") ? ".txt" : "[extname]"}` },
  ]) {
    const namingPlugin = {
      name: "override-asset-naming",
      outputOptions: {
        order,
        handler(options) { return { ...options, assetFileNames: naming }; },
      },
    };
    const first = await buildAssets({ namingPlugin, namingFirst: true });
    const last = await buildAssets({ namingPlugin });
    expect(first.files).toEqual(last.files);
    expect(last.files).toContain("_goribu/assets/image-uhfvulzf.txt");
  }
});

it("rejects fixed names even when they look like valid hash tokens", async () => {
  for (const overrides of [
    { entryFileNames: "_goribu/assets/client-fallback.js" },
    { entryFileNames: "_goribu/assets/client-A1b2C3d4.js" },
    { fileName: "_goribu/assets/probe-qhtdyqap.txt" },
    { fileName: "_goribu/assets/probe-A1b2C3d4.txt", hook: "generateBundle" },
    { assetFileNames: "_goribu/assets/probe-fallback.txt" },
  ]) {
    await expect(buildAssets(overrides)).rejects.toThrow(/\[Goribu\].*carries no content hash/);
  }
});
