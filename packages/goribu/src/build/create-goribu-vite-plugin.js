import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { generateManifest } from "../routing/generate-manifest.js";
import { createClientAssetManifestPlugin } from "./create-client-asset-manifest-plugin.js";
import { createClientBoundaryPlugin } from "./create-client-boundary-plugin.js";
import { createClientPageManifestPlugin } from "./create-client-page-manifest-plugin.js";
import { writeWorkerEntry } from "./generate-worker-entry.js";
import { writeWranglerConfig } from "./generate-wrangler-config.js";
import { loadApplicationConfig } from "./load-application-config.js";

const CLIENT_ENTRY = "src/client-entry.js";
const GENERATED_WRANGLER_CONFIG = ".goribu/wrangler.json";
const CLIENT_ASSETS_MODULE = "virtual:goribu/client-assets";
const RESOLVED_CLIENT_ASSETS_MODULE = `\0${CLIENT_ASSETS_MODULE}`;

// Goribu's content-hashed client build is written under the reserved `/_goribu/`
// namespace. The immutable header targets only this namespace, never app-authored
// files under `public/` (which may sit at `/assets/` without a hash). A one-year
// immutable cache is only safe if a file's URL changes whenever its bytes do, so
// the build audits this namespace and fails closed on any file whose name carries
// no content hash — however the app configured Rollup output or whatever plugin
// emitted it. Cloudflare treats `_headers` as configuration and never serves it.
const GENERATED_ASSETS_DIR = "_goribu/assets";
const RESERVED_ASSETS_PREFIX = "_goribu/assets/";
const ASSET_HEADERS = `/_goribu/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`;

/**
 * Compose Goribu's Vite integration.
 *
 * This is the walking skeleton: it drives the production build through the
 * Cloudflare Vite plugin so one `vite build` emits both the Worker bundle and
 * the client bundle. Goribu generates the Worker entry into `.goribu/worker.js`,
 * synthesizes `.goribu/wrangler.json` from `goribu.config.js`, and points the
 * Cloudflare plugin at that generated config so the app never hand-writes a
 * Wrangler file. Routing and the dev server are added in later steps.
 *
 * Every generated artifact derives from Vite's resolved project root. The
 * Cloudflare plugin resolves a relative `configPath` against that same root, so
 * the synthesized config and the Worker entry always share one root.
 */
export function goribu(options) {
  if (options !== undefined) {
    throw new TypeError(
      "[Goribu] goribu() does not accept options. Set Vite's root to the application directory and keep the client entry at src/client-entry.js.",
    );
  }

  return [
    createGoribuPlugin(),
    createConfiguredClientBoundaryPlugin(),
    createConfiguredClientPageManifestPlugin(),
    createConfiguredClientAssetsPlugin(),
    ...cloudflare({ configPath: GENERATED_WRANGLER_CONFIG }),
  ];
}

function createGoribuPlugin() {
  return {
    name: "goribu",
    enforce: "pre",

    // Runs before the Cloudflare plugin resolves configPath (this plugin is
    // enforce: "pre"), so the generated Worker entry and Wrangler config are on
    // disk by the time it reads them.
    async config(config, environment = {}) {
      const root = config.root ? resolve(config.root) : process.cwd();
      const mode =
        environment.command === "serve" ? "development" : "production";
      assertNoReservedPublicFiles(root, config.publicDir);
      writeWorkerEntry({ projectRoot: root, mode });
      const appConfig = await loadApplicationConfig({ projectRoot: root });
      writeWranglerConfig({ projectRoot: root, appConfig });
      return {
        builder: {
          buildApp: buildClientBeforeWorkers,
        },
        environments: {
          client: {
            build: {
              // Write the hashed client build into the reserved namespace the
              // immutable header targets, keeping that namespace fingerprint-only.
              assetsDir: GENERATED_ASSETS_DIR,
              rollupOptions: {
                input: resolve(root, CLIENT_ENTRY),
              },
            },
          },
        },
      };
    },

    // Emit the blanket asset headers into the client output only. The Worker
    // build shares this plugin, so the environment guard keeps `_headers` out of
    // the Worker bundle, where it would mean nothing.
    generateBundle() {
      if (this.environment?.name !== "client") return;
      this.emitFile({ type: "asset", fileName: "_headers", source: ASSET_HEADERS });
    },

    // Audit the finished bundle after every plugin has contributed, so the check
    // sees the final names of core chunks (named by the app's Rollup output
    // config) and of assets emitted by any other plugin. Only the client build
    // ever contains files under the reserved namespace, so the prefix filter is
    // the guard and no environment check is needed. Failing here still fails the
    // build before the separate deploy step, so nothing unsafe ships.
    writeBundle(_options, bundle) {
      const unhashed = findUnhashedReservedAsset(bundle);
      if (unhashed !== null) {
        this.error(
          `[Goribu] The file ${JSON.stringify(unhashed)} is served from the reserved /_goribu/assets/ namespace but its name carries no content hash. ` +
            "Goribu caches that namespace immutably for a year, so a file there must be fingerprinted. " +
            "Let Goribu name the client build (do not override entryFileNames/chunkFileNames/assetFileNames for the client), and do not emit fixed-name files into /_goribu/.",
        );
      }
    },
  };
}

async function buildClientBeforeWorkers(builder) {
  // Cloudflare's default orchestration builds Workers first. Goribu's Worker
  // embeds the completed browser graph, so the client must finish before any
  // Worker environment can request the virtual asset module.
  const client = builder.environments.client;
  if (!client) {
    throw new Error(
      '[Goribu] The production build has no "client" environment. Keep Goribu\'s client environment enabled so its asset manifest can be captured before the Worker is bundled.',
    );
  }

  await builder.build(client);
  const workers = Object.values(builder.environments).filter(
    (environment) => environment !== client,
  );
  await Promise.all(workers.map((environment) => builder.build(environment)));
}

/**
 * Create the client-boundary plugin after Vite supplies the application root.
 * `goribu()` is called while config is loading, when `root` may still differ from
 * process.cwd(); resolving here keeps the boundary aligned with the same root the
 * generated Worker and Wrangler configuration use.
 */
function createConfiguredClientBoundaryPlugin() {
  let boundary;

  return {
    name: "goribu:client-boundary",
    enforce: "pre",

    config(config) {
      const root = config.root ? resolve(config.root) : process.cwd();
      boundary = createClientBoundaryPlugin({
        routesDir: resolve(root, "src/routes"),
      });
    },

    resolveId(source, importer, options) {
      return requireClientBoundary(boundary).resolveId.call(
        this,
        source,
        importer,
        options,
      );
    },

    // Substep 1 added the virtual route loader to the boundary itself. Delegate
    // it here so imports generated by the page manifest work through goribu(),
    // not only when the boundary plugin is used directly in isolation.
    load(id) {
      return requireClientBoundary(boundary).load.call(this, id);
    },

    generateBundle(options, bundle, isWrite) {
      return requireClientBoundary(boundary).generateBundle.call(
        this,
        options,
        bundle,
        isWrite,
      );
    },
  };
}

function requireClientBoundary(boundary) {
  if (boundary) return boundary;
  throw new Error(
    "[Goribu] The client boundary ran before Vite configured the application root. Run it through goribu() so server-only modules can be checked against src/routes.",
  );
}

/**
 * Generate the browser page-loader map from the same canonical route inventory
 * as the Worker after Vite supplies the application root. Only client code
 * imports this virtual module; preparing it here keeps Worker and browser route
 * IDs aligned without introducing a second scan convention.
 */
function createConfiguredClientPageManifestPlugin() {
  let pageManifest;

  return {
    name: "goribu:client-page-manifest",
    enforce: "pre",

    config(config) {
      const root = config.root ? resolve(config.root) : process.cwd();
      const manifest = generateManifest({
        projectRoot: root,
        routesDir: resolve(root, "src/routes"),
      });
      pageManifest = createClientPageManifestPlugin(manifest);
    },

    resolveId(source, importer, options) {
      return requireClientPageManifest(pageManifest).resolveId.call(
        this,
        source,
        importer,
        options,
      );
    },

    load(id) {
      return requireClientPageManifest(pageManifest).load.call(this, id);
    },
  };
}

function requireClientPageManifest(pageManifest) {
  if (pageManifest) return pageManifest;
  throw new Error(
    "[Goribu] The client page manifest ran before Vite configured the application root. Run it through goribu() so browser page loaders use the current src/routes manifest.",
  );
}

/**
 * Capture the production browser graph, then expose it to the later Worker build
 * through a virtual module. This plugin instance is deliberately shared across
 * build environments: the client generateBundle hook writes the closure state
 * that the Worker load hook reads after buildClientBeforeWorkers has completed.
 */
function createConfiguredClientAssetsPlugin() {
  let assetManifestPlugin;
  let clientAssetManifest = null;
  let clientAssetBase = "/";
  let production = false;

  return {
    name: "goribu:client-assets",
    enforce: "post",
    sharedDuringBuild: true,

    config(config, environment = {}) {
      const root = config.root ? resolve(config.root) : process.cwd();
      const manifest = generateManifest({
        projectRoot: root,
        routesDir: resolve(root, "src/routes"),
      });
      production = environment.command === "build";
      clientAssetBase = config.base ?? "/";
      clientAssetManifest = null;
      assetManifestPlugin = createClientAssetManifestPlugin({
        manifest,
        onManifest(manifestValue) {
          clientAssetManifest = manifestValue;
        },
      });
    },

    configResolved(config) {
      production = config.command === "build";
      clientAssetBase = config.base;
    },

    resolveId(source) {
      return source === CLIENT_ASSETS_MODULE
        ? RESOLVED_CLIENT_ASSETS_MODULE
        : null;
    },

    load(id) {
      if (id !== RESOLVED_CLIENT_ASSETS_MODULE) return null;
      if (production && clientAssetManifest === null) {
        throw new Error(
          "[Goribu] The Worker build requested the client asset manifest before the production client build captured it. Rebuild the Worker and client outputs together through `goribu build`; the client environment must complete before Worker bundling begins.",
        );
      }

      return [
        `export const clientAssetManifest = ${JSON.stringify(clientAssetManifest)};`,
        `export const clientAssetBase = ${JSON.stringify(clientAssetBase)};`,
      ].join("\n");
    },

    generateBundle(outputOptions, bundle, isWrite) {
      if (this.environment?.name !== "client") return;
      return requireClientAssetManifestPlugin(assetManifestPlugin).generateBundle.call(
        this,
        outputOptions,
        bundle,
        isWrite,
      );
    },
  };
}

function requireClientAssetManifestPlugin(plugin) {
  if (plugin) return plugin;
  throw new Error(
    "[Goribu] The client asset manifest ran before Vite configured the application root. Run it through goribu() so production browser assets use the current route manifest.",
  );
}

/**
 * Return the first file under the reserved immutable namespace whose name has no
 * content hash, or null when every such file is fingerprinted.
 *
 * Vite's generated content hash is the final eight base64url characters after a
 * hyphen. The hash itself may contain `-`, so its known length — not the final
 * hyphen — anchors the boundary. A real hash also carries at least one digit or
 * uppercase letter, separating it from a dictionary tail such as `fallback`.
 * This guard is deliberately pinned to Vite's default hash length: if a future
 * Vite changes that contract, the build fails closed until Goribu verifies it.
 */
function findUnhashedReservedAsset(bundle) {
  for (const fileName of Object.keys(bundle)) {
    if (!fileName.startsWith(RESERVED_ASSETS_PREFIX)) continue;
    if (!isHashedAssetName(fileName)) return fileName;
  }
  return null;
}

function isHashedAssetName(fileName) {
  const base = fileName.slice(fileName.lastIndexOf("/") + 1);
  const stem = base.replace(/(?:\.[A-Za-z0-9]+)+$/, "");
  const token = stem.slice(-8);

  return (
    stem.at(-9) === "-" &&
    /^[A-Za-z0-9_-]{8}$/.test(token) &&
    /[0-9A-Z]/.test(token)
  );
}

/**
 * Fail the build when the app's `public/` directory would collide with output
 * Goribu owns. Goribu generates the `_headers` file, so an app-authored one would
 * be silently overwritten; and `/_goribu/` is reserved for framework internals,
 * so nothing published from `public/` may land there.
 */
function assertNoReservedPublicFiles(root, configuredPublicDir) {
  if (configuredPublicDir === false) return;
  const publicDir = resolve(root, configuredPublicDir ?? "public");

  const headersFile = join(publicDir, "_headers");
  if (existsSync(headersFile)) {
    throw new Error(
      `[Goribu] Goribu generates the static-asset ${JSON.stringify("_headers")} file, so an app cannot also provide ${JSON.stringify(headersFile)}. ` +
        "Remove it; per-app static header rules are not configurable yet.",
    );
  }

  const reservedDir = join(publicDir, "_goribu");
  if (existsSync(reservedDir)) {
    throw new Error(
      `[Goribu] The /_goribu/ URL namespace is reserved for Goribu's generated assets, so ${JSON.stringify(reservedDir)} cannot be published. ` +
        "Move those files under a different folder in public/.",
    );
  }
}
