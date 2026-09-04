import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("goribu()", () => {
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

  it("rejects options with a teaching error", () => {
    expect(() => goribu({})).toThrow(/does not accept options/);
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
    const client = { name: "client" };
    const workerA = { name: "worker-a" };
    const workerB = { name: "worker-b" };
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

    await goribuPlugin().config({ root }, { command });

    expect(readFileSync(join(root, ".goribu", "worker.js"), "utf8")).toContain(
      `const mode = ${JSON.stringify(mode)};`,
    );
  });

  it("emits a _headers asset that caches only the reserved fingerprinted namespace", () => {
    const client = emitHeadersFor("client");
    expect(client).toHaveLength(1);
    expect(client[0]).toMatchObject({ type: "asset", fileName: "_headers" });
    expect(client[0].source).toContain("/_goribu/assets/*");
    expect(client[0].source).toContain("Cache-Control: public, max-age=31536000, immutable");

    // The Worker build shares the plugin and must not receive the file.
    expect(emitHeadersFor("goribu_basic_app")).toHaveLength(0);
  });

  it("passes Vite hashes containing dashes and ignores files outside the reserved namespace", () => {
    expect(() =>
      auditBundle({
        "_goribu/assets/client-pages-Dh-wBXR4.js": { type: "chunk" },
        "_goribu/assets/client-route__encoded-N1sL-lhX.js": { type: "chunk" },
        "_goribu/assets/logo-A1b2C3d4.svg": { type: "asset" },
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

    // A dictionary-word segment has no entropy, so it is not mistaken for a hash.
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
