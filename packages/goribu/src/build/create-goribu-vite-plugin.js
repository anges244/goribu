import { existsSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { createClientAssetFingerprints } from "./client-asset-fingerprints.js";
import { generateManifest } from "../routing/generate-manifest.js";
import { createClientAssetManifestPlugin } from "./create-client-asset-manifest-plugin.js";
import {
  createClientBoundaryPlugin,
  routeFilePathFromClientModuleId,
} from "./create-client-boundary-plugin.js";
import { createClientPageManifestPlugin } from "./create-client-page-manifest-plugin.js";
import { assertNoDuplicateD1Declaration } from "./assert-no-duplicate-d1.js";
import { assertNoDuplicateKVDeclaration } from "./assert-no-duplicate-kv.js";
import { assertNoDuplicateR2Declaration } from "./assert-no-duplicate-r2.js";
import { writeWorkerEntry } from "./generate-worker-entry.js";
import { GENERATED_WRANGLER_CONFIG, writeWranglerConfig } from "./generate-wrangler-config.js";
import { APPLICATION_CONFIG_FILENAME, loadApplicationConfig } from "./load-application-config.js";
import { createDevelopmentStylesPlugin } from "./create-development-styles-plugin.js";
import { createDevelopmentLifecyclePlugin } from "./development-lifecycle.js";
import { createDevelopmentImportRecoveryPlugin } from "./development-import-recovery.js";
import { createDevelopmentRouteInventoryPlugin } from "./development-route-inventory.js";
import { BUILD_OUTPUT_DIRECTORY, assertBuildOutputs, createBuildOutputGuardPlugin } from "./build-output.js";

const PUBLIC_ENV_PREFIX = "PUBLIC_";
const CLIENT_ENTRY = "src/setup/client-entry.js";
const GENERATED_DIRECTORY = ".goribu";
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
const ASSET_HEADERS = `/_goribu/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/_goribu/navigation/*\n  Cache-Control: public, max-age=31536000, immutable\n/_goribu/navigation.json\n  Cache-Control: no-store\n`;

/**
 * Compose Goribu's Vite integration.
 *
 * This is the walking skeleton: it drives the production build through the
 * Cloudflare Vite plugin so one `vite build` emits both the Worker bundle and
 * the client bundle. Goribu generates the Worker entry into `.goribu/worker.js`,
 * synthesizes `goribu.wrangler.jsonc` from `goribu.config.js`, and points the
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
      "[Goribu] goribu() does not accept options. Set Vite's root to the application directory and keep the client entry at src/setup/client-entry.js.",
    );
  }

  const navigationBuildId = randomBytes(16).toString("hex");
  const developmentPageIds = new Set();
  return [
    createDevelopmentRouteInventoryPlugin(),
    createGoribuPlugin(navigationBuildId),
    createConfiguredClientBoundaryPlugin(),
    createConfiguredClientPageManifestPlugin(navigationBuildId, developmentPageIds),
    createConfiguredClientAssetsPlugin(navigationBuildId),
    createDevelopmentImportRecoveryPlugin(),
    createDevelopmentStylesPlugin(developmentPageIds),
    createDevelopmentLifecyclePlugin(),
    ...cloudflare({ configPath: GENERATED_WRANGLER_CONFIG }),
    createBuildOutputGuardPlugin(),
  ];
}

function createGoribuPlugin(navigationBuildId) {
  const fingerprints = createClientAssetFingerprints();
  const assetNameTracker = {
    name: "goribu:asset-fingerprints",
    outputOptions: {
      order: "post",
      handler(options) { return fingerprints.outputOptions(options); },
    },
  };

  return {
    name: "goribu",
    enforce: "pre",
    sharedDuringBuild: true,

    // Library RSC annotations don't control Goribu's SSR or hydration. Filter
    // only this known diagnostic; a plugin hook preserves app log handlers.
    onLog(level, log) {
      if (
        level === "warn" &&
        log.code === "MODULE_LEVEL_DIRECTIVE" &&
        typeof log.id === "string" &&
        !log.id.startsWith("\0") &&
        /(?:^|[/\\])node_modules[/\\]/.test(log.id) &&
        typeof log.message === "string" &&
        log.message.includes('module level directive "use client" in ')
      ) {
        return false;
      }
    },

    // Runs before the Cloudflare plugin resolves configPath (this plugin is
    // enforce: "pre"), so the generated Worker entry and Wrangler config are on
    // disk by the time it reads them.
    async config(config, environment = {}) {
      assertCanonicalEnvPrefix(config?.envPrefix, true);
      const root = config.root ? resolve(config.root) : process.cwd();
      if (config.build?.outDir !== undefined && resolve(root, config.build.outDir) !== resolve(root, BUILD_OUTPUT_DIRECTORY)) {
        throw new Error(`[Goribu] Production output belongs in ${BUILD_OUTPUT_DIRECTORY}. Remove the conflicting build.outDir override from your Vite configuration.`);
      }
      const mode =
        environment.command === "serve" ? "development" : "production";
      assertNoReservedPublicFiles(root, config.publicDir);
      assertClientEntry(root);
      writeWorkerEntry({ projectRoot: root, mode });
      const appConfig = await loadApplicationConfig({ projectRoot: root });
      await assertNoDuplicateD1Declaration({ projectRoot: root, appConfig });
      await assertNoDuplicateKVDeclaration({ projectRoot: root, appConfig });
      await assertNoDuplicateR2Declaration({ projectRoot: root, appConfig });
      writeWranglerConfig({ projectRoot: root, appConfig });
      return {
        envPrefix: PUBLIC_ENV_PREFIX,
        // Use the same command-derived mode as the generated Worker, rather
        // than NODE_ENV, to erase development-only R2 serving from builds.
        define: { "import.meta.goribuDevelopment": mode === "development" },
        build: { outDir: BUILD_OUTPUT_DIRECTORY },
        builder: {
          buildApp: (builder) => buildClientBeforeWorkers(builder, assetNameTracker),
        },
        server: {
          watch: {
            // Goribu regenerates its Worker and Wrangler config here, and this hook runs
            // on every config load — including the one that checks a replacement
            // configuration before a restart commits to it. The Cloudflare plugin
            // watches the generated Wrangler config to decide a restart is
            // needed, so leaving Goribu's own output in the watcher means a
            // restart can ask for another restart, decided by where the write
            // lands relative to that plugin's in-flight guard. The source files
            // are watched instead: vite.config.js by Vite, goribu.config.js by
            // the development lifecycle plugin.
            //
            // goribu.config.js is watched there too, and for a second reason:
            // the generated Worker entry imports it, so leaving it here would
            // let Vite invalidate it into the running Worker before anything
            // had decided Goribu accepts it.
            ignored: [
              `**/${GENERATED_DIRECTORY}/**`,
              join(root, GENERATED_WRANGLER_CONFIG),
              join(root, APPLICATION_CONFIG_FILENAME),
            ],
          },
        },
        environments: {
          client: {
            optimizeDeps: {
              // The bootstrap loads pages through a virtual dynamic import, so
              // Vite's initial scan cannot see their shared UI/React imports.
              // Optimize them with the installed bootstrap on the first pass:
              // late discovery can otherwise reload with two React instances.
              include: [
                "goribu",
                "goribu/client",
                "react",
                "react-dom/client",
                "react/jsx-runtime",
                "react/jsx-dev-runtime",
              ],
            },
            build: {
              // Write the hashed client build into the reserved namespace the
              // immutable header targets, keeping that namespace fingerprint-only.
              assetsDir: GENERATED_ASSETS_DIR,
              rollupOptions: {
                input: resolve(root, CLIENT_ENTRY),
                output: {
                  plugins: [assetNameTracker],
                  assetFileNames(asset) {
                    // Extracted CSS uses the original chunk name, independently of
                    // chunkFileNames below, so it can carry the same encoded path.
                    // Name CSS before emission so Vite's graph keeps every URL aligned.
                    return asset.names.some((name) => name.endsWith(".css"))
                      ? `${GENERATED_ASSETS_DIR}/style-[hash][extname]`
                      : `${GENERATED_ASSETS_DIR}/[name]-[hash][extname]`;
                  },
                  chunkFileNames(chunk) {
                    // Rollup derives a dynamic entry's default name from its virtual
                    // module ID. Goribu's route IDs contain an encoded absolute source
                    // path so the loader can recover the file, but that path must not
                    // become part of a public production URL.
                    return routeFilePathFromClientModuleId(chunk.facadeModuleId) === null
                      ? `${GENERATED_ASSETS_DIR}/[name]-[hash].js`
                      : `${GENERATED_ASSETS_DIR}/client-route-[hash].js`;
                  },
                },
              },
            },
          },
        },
      };
    },

    configResolved(config) {
      assertCanonicalEnvPrefix(config.envPrefix, false);
    },

    // Emit the blanket asset headers into the client output only. The Worker
    // build shares this plugin, so the environment guard keeps `_headers` out of
    // the Worker bundle, where it would mean nothing.
    generateBundle() {
      if (this.environment?.name !== "client") return;
      this.emitFile({ type: "asset", fileName: "_headers", source: ASSET_HEADERS });
      // Prerendering finalizes this after both bundles exist. An unfinished build
      // must never advertise candidates as confirmed static routes.
      this.emitFile({ type: "asset", fileName: "_goribu/navigation.json",
        source: JSON.stringify({ buildId: navigationBuildId, routes: null }) });
    },

    // Audit the finished bundle after every plugin has contributed, so the check
    // sees the final names of core chunks (named by the app's Rollup output
    // config) and of assets emitted by any other plugin. Only the client build
    // ever contains files under the reserved namespace, so the prefix filter is
    // the guard and no environment check is needed. Failing here still fails the
    // build before the separate deploy step, so nothing unsafe ships.
    writeBundle(_options, bundle) {
      if (Object.keys(bundle).some((name) => name.startsWith("_goribu/navigation/"))) {
        this.error("[Goribu] Only Goribu's prerender step may write /_goribu/navigation/ snapshots. Remove the plugin output in that reserved namespace so immutable data always has a verified content hash.");
      }
      const unhashed = fingerprints.findUnhashed(bundle, this);
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

async function buildClientBeforeWorkers(builder, assetNameTracker) {
  // Cloudflare's default orchestration builds Workers first. Goribu's Worker
  // embeds the completed browser graph, so the client must finish before any
  // Worker environment can request the virtual asset module.
  const client = builder.environments.client;
  if (!client) {
    throw new Error(
      '[Goribu] The production build has no "client" environment. Keep Goribu\'s client environment enabled so its asset manifest can be captured before the Worker is bundled.',
    );
  }

  assertBuildOutputs(builder.environments);

  // Output plugins run after input plugins. Keep our post hook last among the
  // resolved output plugins too, so it wraps the final naming option regardless
  // of app/plugin ordering. Preserve all other hooks and make repeat builds safe.
  const bundler = client.config.build.rolldownOptions ??= client.config.build.rollupOptions ?? {};
  const outputs = bundler.output ??= {};
  for (const output of Array.isArray(outputs) ? outputs : [outputs]) {
    output.plugins = [output.plugins].flat(Infinity)
      .filter((plugin) => plugin && plugin !== assetNameTracker)
      .concat(assetNameTracker);
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
function createConfiguredClientPageManifestPlugin(navigationBuildId, developmentPageIds) {
  let pageManifest;
  let production = false;

  return {
    name: "goribu:client-page-manifest",
    enforce: "pre",
    sharedDuringBuild: true,

    config(config, environment = {}) {
      production = environment.command === "build";
      const root = config.root ? resolve(config.root) : process.cwd();
      const manifest = generateManifest({
        projectRoot: root,
        routesDir: resolve(root, "src/routes"),
      });
      developmentPageIds.clear();
      if (!production) {
        for (const route of manifest) {
          if (route.hasDefaultExport) developmentPageIds.add(route.id);
        }
      }
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
      const source = requireClientPageManifest(pageManifest).load.call(this, id);
      return source === null ? null : `${source}\nexport const navigationBuildId = ${JSON.stringify(production ? navigationBuildId : null)};`;
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
function createConfiguredClientAssetsPlugin(navigationBuildId) {
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
          clientAssetManifest = { ...manifestValue, navigationBuildId };
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

function assertClientEntry(root) {
  if (existsSync(join(root, "src/client-entry.js"))) {
    throw new Error(
      '[Goribu] src/client-entry.js has moved. Move it to src/setup/client-entry.js, update its relative imports, and set <ClientEntry src="/src/setup/client-entry.js" /> in your Document. Keep only the setup copy.',
    );
  }
  if (!statSync(join(root, CLIENT_ENTRY), { throwIfNoEntry: false })?.isFile()) {
    throw new Error(
      '[Goribu] Missing required src/setup/client-entry.js. Create it with import "goribu/client"; and import your global CSS there. The browser entry is required even when you use the default Document.',
    );
  }
}

function assertCanonicalEnvPrefix(envPrefix, allowUndefined) {
  if (
    (allowUndefined && envPrefix === undefined) ||
    envPrefix === PUBLIC_ENV_PREFIX ||
    (Array.isArray(envPrefix) &&
      envPrefix.length >= 1 &&
      envPrefix.every((prefix) => prefix === PUBLIC_ENV_PREFIX))
  ) {
    return;
  }

  throw new TypeError(
    `[Goribu] Browser environment variables must use only Vite's ${JSON.stringify(PUBLIC_ENV_PREFIX)} envPrefix, but received ${formatEnvPrefix(envPrefix)}. ` +
      "Remove the custom envPrefix and rename browser-visible variables to PUBLIC_*. Keep secrets unprefixed and read server bindings from request.env.",
  );
}

function formatEnvPrefix(envPrefix) {
  try {
    return JSON.stringify(envPrefix) ?? String(envPrefix);
  } catch {
    return String(envPrefix);
  }
}
