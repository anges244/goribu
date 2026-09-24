import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder } from "vite";
import { afterEach, expect, it } from "vitest";
import { goribu } from "goribu/vite";
import { resolveWranglerBin } from "../src/build/resolve-wrangler-bin.js";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
const cli = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));
const roots = [];

function project() {
  const root = mkdtempSync(join(tmpdir(), "goribu-build-output-"));
  roots.push(root);
  cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
  for (const name of ["package.json", "goribu.config.js", "vite.config.js"]) {
    cpSync(join(fixture, name), join(root, name));
  }
  symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function build(root) {
  const result = spawnSync(process.execPath, [cli, "build"], {
    cwd: root, encoding: "utf8", timeout: 100000,
    env: { ...process.env, NODE_ENV: "production" },
  });
  expect(result.error).toBeUndefined();
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

it("tracks naming after app output plugins, including repeat builds and fixed-name rejection", async () => {
  const root = project();
  let pattern = "_goribu/assets/image-[hash][extname]";
  const builder = await createBuilder({
    root, configFile: false, logLevel: "silent",
    plugins: [goribu(), {
      name: "emit-image",
      buildStart() {
        if (this.environment.name === "client") {
          this.emitFile({ type: "asset", name: "image.svg", source: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
        }
      },
    }],
    environments: { client: { build: { rollupOptions: { output: { plugins: [{
      name: "last-output-naming",
      outputOptions: {
        order: "post",
        handler(options) { return { ...options, assetFileNames: pattern }; },
      },
    }] } } } } },
  });

  await builder.buildApp();
  const directory = join(root, ".goribu/dist/client/_goribu/assets");
  const first = readdirSync(directory).filter((name) => name.endsWith(".svg"));
  expect(first).toHaveLength(1);
  expect(first[0]).toMatch(/^image-[A-Za-z0-9_-]{8}\.svg$/);

  await builder.buildApp();
  expect(readdirSync(directory).filter((name) => name.endsWith(".svg"))).toEqual(first);

  pattern = "_goribu/assets/image-fallback[extname]";
  await expect(builder.buildApp()).rejects.toThrow(/\[Goribu\].*carries no content hash/);
}, 30000);

it.each(["buildEnd", "outputOptions"])("preserves generated inputs when %s redirects cleanup to .goribu", async (hook) => {
  const root = project();
  const builder = await createBuilder({ root, configFile: false, logLevel: "silent", plugins: [goribu(), {
    name: "late-cleanup-override", enforce: "post",
    [hook]: {
      order: "post",
      async handler() {
        if (this.environment.name !== "client") return;
        await Promise.resolve();
        this.environment.config.build.outDir = ".goribu";
      },
    },
  }] });
  const worker = join(root, ".goribu/worker.js");
  const workerSource = readFileSync(worker, "utf8");
  const migration = join(root, ".goribu/migrate.wrangler.json");
  const migrationSource = '{"name":"preserve-migration-config"}\n';
  writeFileSync(migration, migrationSource);

  await expect(builder.buildApp()).rejects.toThrow(/\[Goribu\] The client build must output to/);
  expect(readFileSync(worker, "utf8")).toBe(workerSource);
  expect(readFileSync(migration, "utf8")).toBe(migrationSource);
}, 30000);

it("cleans removed static output across builds while preserving inputs, local state, and legacy dist", () => {
  const root = project();
  for (const [path, text] of [
    [".goribu/migrate.wrangler.json", "migration sentinel"],
    [".wrangler/state/sentinel", "local data sentinel"],
    ["dist/sentinel", "legacy output sentinel"],
  ]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  const first = build(root);
  expect(first.status, first.output).toBe(0);
  const redirectPath = join(root, ".wrangler/deploy/config.json");
  const redirect = JSON.parse(readFileSync(redirectPath, "utf8"));
  const configPath = resolve(dirname(redirectPath), redirect.configPath);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const client = resolve(dirname(configPath), config.assets.directory);
  expect(client).toBe(join(root, ".goribu/dist/client"));
  expect(configPath).toBe(join(root, ".goribu/dist/goribu_basic_app/wrangler.json"));
  expect(first.output).toContain("HTML and browser assets: .goribu/dist/client");
  expect(first.output).toContain(`Worker: .goribu/dist/goribu_basic_app/${config.main}`);
  expect(first.output.indexOf("Build complete.")).toBeGreaterThan(first.output.indexOf("Statically output"));

  const navigation = JSON.parse(readFileSync(join(client, "_goribu/navigation.json"), "utf8"));
  const snapshot = join(client, navigation.routes["/about"].asset.slice(1));
  expect(existsSync(snapshot)).toBe(true);
  expect(existsSync(join(client, "about.html"))).toBe(true);
  const workerInput = readFileSync(join(root, ".goribu/worker.js"), "utf8");
  expect(workerInput).toContain("src/routes/about.jsx");

  rmSync(join(root, "src/routes/about.jsx"));
  const second = build(root);
  expect(second.status, second.output).toBe(0);
  expect(existsSync(join(client, "about.html"))).toBe(false);
  expect(existsSync(snapshot)).toBe(false);
  expect(existsSync(join(client, "_goribu/navigation", navigation.buildId))).toBe(false);
  const current = JSON.parse(readFileSync(join(client, "_goribu/navigation.json"), "utf8"));
  expect(current.routes).not.toHaveProperty("/about");
  expect(current.routes).toHaveProperty("/");
  expect(readFileSync(join(root, ".goribu/worker.js"), "utf8")).not.toContain("src/routes/about.jsx");
  expect(readFileSync(join(root, ".goribu/migrate.wrangler.json"), "utf8")).toBe("migration sentinel");
  expect(readFileSync(join(root, ".wrangler/state/sentinel"), "utf8")).toBe("local data sentinel");
  expect(readFileSync(join(root, "dist/sentinel"), "utf8")).toBe("legacy output sentinel");
  expect(existsSync(join(root, "goribu.wrangler.jsonc"))).toBe(true);

  const dryRun = spawnSync(process.execPath, [resolveWranglerBin(), "deploy", "--dry-run"], {
    cwd: root, encoding: "utf8", timeout: 30000,
  });
  expect(dryRun.error).toBeUndefined();
  expect(dryRun.status, `${dryRun.stdout}\n${dryRun.stderr}`).toBe(0);

  writeFileSync(join(root, "src/routes/fail.jsx"), 'export const prerender = true; export default function Fail() { throw new Error("forced failure"); }');
  const failed = build(root);
  expect(failed.status).not.toBe(0);
  expect(failed.output).toContain("sets `export const prerender = true`");
  expect(failed.output).not.toContain("[Goribu] Build complete.");
  expect(failed.output).not.toContain("HTML and browser assets:");
}, 120000);

it("rejects output and cleanup overrides, including late resolved-config mutations", async () => {
  const cases = [
    { build: { outDir: "elsewhere" } },
    { environments: { client: { build: { outDir: ".goribu" } } } },
    { environments: { goribu_basic_app: { build: { outDir: "elsewhere" } } } },
    { build: { emptyOutDir: false } },
    { environments: { client: { build: { emptyOutDir: false } } } },
    { build: { rollupOptions: { output: { dir: "elsewhere" } } } },
    { build: { rollupOptions: { output: { dir: ".goribu/dist/client" } } } },
    { build: { rollupOptions: { output: { file: "elsewhere.js" } } } },
  ];
  for (const overrides of cases) {
    const root = project();
    await expect((async () => {
      const builder = await createBuilder({ root, configFile: false, logLevel: "silent", plugins: [goribu()], ...overrides });
      await builder.buildApp();
    })()).rejects.toThrow(/\[Goribu\].*(output|emptyOutDir)/);
    expect(existsSync(join(root, "elsewhere"))).toBe(false);
  }

  for (const change of [
    (config) => { config.environments.client.build.outDir = ".goribu"; },
    (config) => { config.environments.goribu_basic_app.build.emptyOutDir = false; },
  ]) {
    const root = project();
    const builder = await createBuilder({ root, configFile: false, logLevel: "silent", plugins: [goribu(), {
      name: "late-output-override", enforce: "post",
      async configResolved(config) { await Promise.resolve(); change(config); },
    }] });
    await expect(builder.buildApp()).rejects.toThrow(/\[Goribu\].*(output|emptyOutDir)/);
    expect(existsSync(join(root, ".goribu/worker.js"))).toBe(true);
  }

  const root = project();
  const builder = await createBuilder({ root, configFile: false, logLevel: "silent", plugins: [goribu(), {
    name: "late-bundler-output-override", enforce: "post",
    outputOptions: {
      order: "post",
      handler(output) { return { ...output, dir: join(root, "redirected-output") }; },
    },
  }] });
  await expect(builder.buildApp()).rejects.toThrow(/\[Goribu\].*output.dir\/output.file/);
  expect(existsSync(join(root, "redirected-output"))).toBe(false);
}, 60000);
