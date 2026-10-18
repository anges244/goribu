import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder } from "vite";
import { afterEach, expect, it } from "vitest";
import { goribu } from "goribu/vite";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
const cli = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));
const roots = [];

function project() {
  const root = mkdtempSync(join(tmpdir(), "goribu-postgres-bundle-"));
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

it("includes Postgres.js only in a Postgres app's Worker bundle", async () => {
  for (const postgres of [false, true]) {
    const root = project();
    if (postgres) {
      const config = join(root, "goribu.config.js");
      writeFileSync(config, readFileSync(config, "utf8").replace("defineConfig({", 'defineConfig({\n  database: { type: "postgres" },'));
    }
    const builder = await createBuilder({ root, configFile: false, logLevel: "silent", plugins: [goribu()] });
    await builder.buildApp();
    const worker = readFileSync(join(root, ".goribu/dist/goribu_basic_app/index.js"), "utf8");
    for (const marker of ["cloudflare:sockets", "POSTGRES_CACHED"]) {
      expect(worker.includes(marker), `${marker} in ${postgres ? "Postgres" : "non-Postgres"} bundle`).toBe(postgres);
    }
  }
}, 120000);

it("builds and prerenders a Postgres app without local Hyperdrive variables or placeholder artifacts", () => {
  const root = project();
  const config = join(root, "goribu.config.js");
  writeFileSync(config, readFileSync(config, "utf8").replace("defineConfig({", 'defineConfig({\n  database: { type: "postgres" },'));
  const env = { ...process.env, NODE_ENV: "production" };
  delete env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_POSTGRES;
  delete env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_POSTGRES_CACHED;
  const result = spawnSync(process.execPath, [cli, "build"], { cwd: root, encoding: "utf8", timeout: 100000, env });
  expect(result.error).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const generated = join(root, ".goribu");
  for (const file of readdirSync(generated, { recursive: true, withFileTypes: true })) {
    if (file.isFile()) expect(readFileSync(join(file.parentPath, file.name), "utf8")).not.toContain("prerender.invalid");
  }
}, 120000);
