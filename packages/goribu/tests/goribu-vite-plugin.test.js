import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { goribu } from "goribu/vite";

const APPLICATION_CONFIG_URL = new URL(
  "../src/runtime/application-config.js",
  import.meta.url,
).href;

const created = [];
const hyperdriveVariables = [
  "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_POSTGRES",
  "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_POSTGRES_CACHED",
];
const previousHyperdriveEnv = Object.fromEntries(hyperdriveVariables.map((key) => [key, process.env[key]]));

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "goribu-plugin-"));
  created.push(root);
  return root;
}

function goribuPlugin() {
  return goribu().find((candidate) => candidate?.name === "goribu");
}

function clientAssetsPlugin() {
  return goribu().find(
    (candidate) => candidate?.name === "goribu:client-assets",
  );
}

function writeMinimalProject(root) {
  mkdirSync(join(root, "src/setup"), { recursive: true });
  writeFileSync(join(root, "src/setup/client-entry.js"), 'import "goribu/client";\n');
  mkdirSync(join(root, "src", "routes"), { recursive: true });
  writeFileSync(
    join(root, "src", "routes", "index.jsx"),
    "export default function Page() { return null; }\n",
  );
  writeFileSync(
    join(root, "goribu.config.js"),
    `import { defineConfig } from ${JSON.stringify(APPLICATION_CONFIG_URL)};\n` +
      'export default defineConfig({ name: "test-app", compatibilityDate: "2026-08-31" });\n',
  );
}

afterEach(() => {
  for (const [key, value] of Object.entries(previousHyperdriveEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("goribu()", () => {
  it("injects the local Postgres URL only for serve and never writes it to generated files", async () => {
    const root = makeProject();
    writeMinimalProject(root);
    const configFile = join(root, "goribu.config.js");
    writeFileSync(configFile, readFileSync(configFile, "utf8").replace("defineConfig({", 'defineConfig({ database: { type: "postgres" },'));
    const url = "postgres://app:private-test-password@localhost:5432/app";
    writeFileSync(join(root, ".env"), `POSTGRES_URL=${url}\n`);
    for (const key of hyperdriveVariables) process.env[key] = "shell-value-must-be-overwritten";
    const plugin = goribuPlugin();
    await plugin.config({ root }, { command: "serve" });
    for (const key of hyperdriveVariables) expect(process.env[key]).toBe(url);
    expect(readFileSync(join(root, "goribu.wrangler.jsonc"), "utf8")).not.toContain(url);
    const generated = join(root, ".goribu");
    for (const file of readdirSync(generated, { recursive: true, withFileTypes: true })) {
      if (file.isFile()) expect(readFileSync(join(file.parentPath, file.name), "utf8")).not.toContain(url);
    }
    for (const key of hyperdriveVariables) delete process.env[key];
    await plugin.config({ root }, { command: "build" });
    for (const key of hyperdriveVariables) expect(process.env[key]).toBeUndefined();
    rmSync(join(root, ".env"));
    await expect(plugin.config({ root }, { command: "serve" })).rejects.toThrow(
      "[Goribu] POSTGRES_URL is missing from .env and .env.local. Add it to .env (create that file if needed), or set it in .env.local to override .env. Goribu reads these files only when .dev.vars does not exist.",
    );
  });

  it("generates a dev secret only for serve with R2, never in Wrangler's config file", async () => {
    const root = makeProject();
    writeMinimalProject(root);
    const plugin = goribuPlugin();
    const secretFile = join(root, ".goribu/dev-secret");
    await plugin.config({ root }, { command: "serve" });
    expect(existsSync(secretFile)).toBe(false);
    writeFileSync(join(root, "goribu.config.js"),
      `import { defineConfig } from ${JSON.stringify(APPLICATION_CONFIG_URL)};\n` +
      'export default defineConfig({ name: "test-app", compatibilityDate: "2026-09-01", r2: { name: "test-files" } });\n');
    await plugin.config({ root }, { command: "build" });
    expect(existsSync(secretFile)).toBe(false);
    await plugin.config({ root }, { command: "serve" });
    expect(existsSync(secretFile)).toBe(true);
    expect(readFileSync(join(root, "goribu.wrangler.jsonc"), "utf8")).not.toContain("GORIBU_SECRET");
    // Build must not read dev state, even in a reused plugin instance.
    writeFileSync(secretFile, "corrupt-dev-state");
    await plugin.config({ root }, { command: "build" });
    expect(readFileSync(secretFile, "utf8")).toBe("corrupt-dev-state");
  });

  it("requires the setup entry and rejects legacy entries in development and production", async () => {
    for (const command of ["serve", "build"]) {
      const root = makeProject();
      writeMinimalProject(root);
      const entry = join(root, "src/setup/client-entry.js");
      rmSync(entry);
      await expect(goribuPlugin().config({ root }, { command })).rejects.toThrow(
        /Missing required src\/setup\/client-entry.js.*import "goribu\/client"/,
      );
      writeFileSync(join(root, "src/client-entry.js"), 'import "goribu/client";\n');
      await expect(goribuPlugin().config({ root }, { command })).rejects.toThrow(
        /Move it to src\/setup\/client-entry.js/,
      );
      writeFileSync(entry, 'import "goribu/client";\n');
      await expect(goribuPlugin().config({ root }, { command })).rejects.toThrow(/Keep only the setup copy/);
      rmSync(join(root, "src/client-entry.js"));
      const config = await goribuPlugin().config({ root }, { command });
      expect(config.environments.client.build.rollupOptions.input).toBe(entry);
    }
  });

  it("rejects duplicate KV ownership during both development and production setup", async () => {
    for (const command of ["serve", "build"]) {
      const root = makeProject();
      writeMinimalProject(root);
      writeFileSync(join(root, "goribu.config.js"),
        `import { defineConfig } from ${JSON.stringify(APPLICATION_CONFIG_URL)};\n` +
        'export default defineConfig({ name: "test-app", compatibilityDate: "2026-09-04", kv: { name: "test-kv" } });\n');
      writeFileSync(join(root, "wrangler.json"), '{"kv_namespaces":[]}');
      await expect(goribuPlugin().config({ root }, { command })).rejects.toThrow(/Remove the kv_namespaces declaration/);
    }
  });

  it("rejects duplicate Hyperdrive ownership during development and production setup", async () => {
    for (const command of ["serve", "build"]) {
      const root = makeProject();
      writeMinimalProject(root);
      writeFileSync(join(root, "goribu.config.js"),
        `import { defineConfig } from ${JSON.stringify(APPLICATION_CONFIG_URL)};\n` +
        'export default defineConfig({ name: "test-app", compatibilityDate: "2026-09-01", database: { type: "postgres" } });\n');
      writeFileSync(join(root, "wrangler.json"), '{"hyperdrive":[]}');
      await expect(goribuPlugin().config({ root }, { command }))
        .rejects.toThrow(/Remove the hyperdrive entry.*set hyperdriveId and hyperdriveCachedId/);
    }
  });

  it("rejects options with a teaching error", () => {
    expect(() => goribu({})).toThrow(/does not accept options/);
  });

  it("rejects duplicate R2 ownership during development and production setup", async () => {
    for (const command of ["serve", "build"]) {
      const root = makeProject();
      writeMinimalProject(root);
      writeFileSync(join(root, "goribu.config.js"),
        `import { defineConfig } from ${JSON.stringify(APPLICATION_CONFIG_URL)};\n` +
        'export default defineConfig({ name: "test-app", compatibilityDate: "2026-09-01", r2: { name: "test-files" } });\n');
      writeFileSync(join(root, "wrangler.json"), '{"r2_buckets":[]}');
      await expect(goribuPlugin().config({ root }, { command })).rejects.toThrow(/Remove the r2_buckets declaration/);
    }
  });

  it("returns build, client-boundary, page-manifest, and client-assets plugins", () => {
    const plugins = goribu();
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins.some((plugin) => plugin?.name === "goribu")).toBe(true);
    expect(
      plugins.some((plugin) => plugin?.name === "goribu:client-boundary"),
    ).toBe(true);
    expect(
      plugins.some((plugin) => plugin?.name === "goribu:client-page-manifest"),
    ).toBe(true);
    expect(
      plugins.some((plugin) => plugin?.name === "goribu:client-assets"),
    ).toBe(true);
  });

  it("builds the client before every Worker environment", async () => {
    const root = makeProject();
    writeMinimalProject(root);
    const configured = await goribuPlugin().config(
      { root },
      { command: "build" },
    );
    const environment = (name) => ({ name, config: {
      root, build: { outDir: join(root, ".goribu/dist", name) },
    } });
    const client = environment("client");
    const workerA = environment("worker-a");
    const workerB = environment("worker-b");
    const order = [];

    await configured.builder.buildApp({
      environments: { workerA, client, workerB },
      async build(environment) {
        order.push(environment.name);
      },
    });

    expect(order[0]).toBe("client");
    expect(new Set(order.slice(1))).toEqual(new Set(["worker-a", "worker-b"]));
  });

  it("fails closed when production Worker assets are requested before client capture", () => {
    const root = makeProject();
    writeMinimalProject(root);
    const plugin = clientAssetsPlugin();
    plugin.config({ root }, { command: "build" });
    plugin.configResolved({ command: "build", base: "/" });
    const id = plugin.resolveId("virtual:goribu/client-assets");

    expect(plugin.sharedDuringBuild).toBe(true);
    expect(() => plugin.load(id)).toThrow(
      /client asset manifest before the production client build captured it.*goribu build/s,
    );
  });

  it("serves one captured manifest and the normalized Vite base to the Worker", () => {
    const root = makeProject();
    writeMinimalProject(root);
    const plugin = clientAssetsPlugin();
    plugin.config({ root, base: "/docs" }, { command: "build" });
    plugin.configResolved({ command: "build", base: "/docs/" });
    plugin.generateBundle.call(
      { environment: { name: "client" } },
      {},
      {
        "_goribu/assets/client-entry-hash.js": {
          type: "chunk",
          fileName: "_goribu/assets/client-entry-hash.js",
          isEntry: true,
          imports: [],
          viteMetadata: { importedCss: new Set() },
        },
      },
    );

    const source = plugin.load(plugin.resolveId("virtual:goribu/client-assets"));
    expect(source).toContain(
      '"file":"_goribu/assets/client-entry-hash.js"',
    );
    expect(source).toContain('export const clientAssetBase = "/docs/";');
  });

  const emitHeadersFor = (environmentName) => {
    const emitted = [];
    goribuPlugin().generateBundle.call({
      environment: { name: environmentName },
      emitFile: (file) => emitted.push(file),
    });
    return emitted;
  };

  const auditBundle = (bundle) => {
    goribuPlugin().writeBundle.call(
      {
        error: (message) => {
          throw new Error(typeof message === "string" ? message : message.message);
        },
      },
      {},
      bundle,
    );
  };

  it.each([
    ["serve", "development"],
    ["build", "production"],
  ])("bakes Vite command %s into the generated %s Worker", async (command, mode) => {
    const root = makeProject();
    writeMinimalProject(root);

    const config = await goribuPlugin().config({ root }, { command });
    expect(config.define["import.meta.goribuDevelopment"]).toBe(mode === "development");

    expect(readFileSync(join(root, ".goribu", "worker.js"), "utf8")).toContain(
      `const mode = ${JSON.stringify(mode)};`,
    );
  });

  it("emits immutable asset rules and an unfinished, uncached navigation index", () => {
    const client = emitHeadersFor("client");
    expect(client).toHaveLength(2);
    expect(client[0]).toMatchObject({ type: "asset", fileName: "_headers" });
    expect(client[0].source).toContain("/_goribu/assets/*");
    expect(client[0].source).toContain("Cache-Control: public, max-age=31536000, immutable");
    expect(client[0].source).toContain("/_goribu/navigation.json\n  Cache-Control: no-store");
    expect(JSON.parse(client[1].source)).toMatchObject({ routes: null });

    // The Worker build shares the plugin and must not receive the file.
    expect(emitHeadersFor("goribu_basic_app")).toHaveLength(0);
  });

  it("rejects plugin output in the prerender-owned immutable navigation namespace", () => {
    expect(() => auditBundle({ "_goribu/navigation/latest.json": { type: "asset" } }))
      .toThrow(/Only Goribu's prerender step/);
  });

  it("passes generated hashes including lowercase and dashes, and ignores other namespaces", () => {
    expect(() =>
      auditBundle({
        "_goribu/assets/client-pages-Dh-wBXR4.js": {
          type: "chunk",
          fileName: "_goribu/assets/client-pages-Dh-wBXR4.js",
          preliminaryFileName: "_goribu/assets/client-pages-!~{000}~.js",
        },
        "_goribu/assets/client-route__encoded-N1sL-lhX.js": {
          type: "chunk",
          fileName: "_goribu/assets/client-route__encoded-N1sL-lhX.js",
          preliminaryFileName: "_goribu/assets/client-route__encoded-!~{001}~.js",
        },
        "_goribu/assets/client-qhtdyqap.js": {
          type: "chunk",
          fileName: "_goribu/assets/client-qhtdyqap.js",
          preliminaryFileName: "_goribu/assets/client-!~{002}~.js",
        },
        "robots.txt": { type: "asset" },
        "assets/vendor.js": { type: "chunk" },
      }),
    ).not.toThrow();
  });

  it("fails closed on a non-fingerprinted file under the reserved namespace", () => {
    // App output with a descriptive chunk name but no generated hash.
    expect(() =>
      auditBundle({ "_goribu/assets/client-pages.js": { type: "chunk" } }),
    ).toThrow(/carries no content hash/);

    // A bare entry name is shorter than the required delimiter plus hash.
    expect(() =>
      auditBundle({ "_goribu/assets/entry.js": { type: "chunk" } }),
    ).toThrow(/carries no content hash/);

    // A fixed name has no bundler hash placeholder, even if it looks like a hash.
    expect(() =>
      auditBundle({ "_goribu/assets/client-fallback.js": { type: "chunk" } }),
    ).toThrow(/carries no content hash/);

    // A fixed-name asset emitted straight into the namespace by another plugin.
    expect(() =>
      auditBundle({ "_goribu/assets/logo.svg": { type: "asset" } }),
    ).toThrow(/carries no content hash/);
  });

  it("fails closed when the app ships its own public/_headers", async () => {
    const root = makeProject();
    mkdirSync(join(root, "public"), { recursive: true });
    writeFileSync(join(root, "public", "_headers"), "/*\n  X-Test: 1\n");

    await expect(goribuPlugin().config({ root })).rejects.toThrow(
      /Goribu generates the static-asset "_headers" file/,
    );
  });

  it("fails closed when the app publishes into the reserved /_goribu/ namespace", async () => {
    const root = makeProject();
    mkdirSync(join(root, "public", "_goribu"), { recursive: true });

    await expect(goribuPlugin().config({ root })).rejects.toThrow(
      /\/_goribu\/ URL namespace is reserved/,
    );
  });
});
