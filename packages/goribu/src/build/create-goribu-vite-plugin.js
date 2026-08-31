import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { loadApplicationConfig } from "./load-application-config.js";
import { writeWorkerEntry } from "./generate-worker-entry.js";
import { writeWranglerConfig } from "./generate-wrangler-config.js";

const CLIENT_ENTRY = "src/client-entry.js";
const GENERATED_WRANGLER_CONFIG = ".goribu/wrangler.json";

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

  return [createGoribuPlugin(), ...cloudflare({ configPath: GENERATED_WRANGLER_CONFIG })];
}

function createGoribuPlugin() {
  return {
    name: "goribu",
    enforce: "pre",

    // Runs before the Cloudflare plugin resolves configPath (this plugin is
    // enforce: "pre"), so the generated Worker entry and Wrangler config are on
    // disk by the time it reads them.
    async config(config) {
      const root = config.root ? resolve(config.root) : process.cwd();
      assertNoReservedPublicFiles(root, config.publicDir);
      writeWorkerEntry({ projectRoot: root });
      const appConfig = await loadApplicationConfig({ projectRoot: root });
      writeWranglerConfig({ projectRoot: root, appConfig });
      return {
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

/**
 * Return the first file under the reserved immutable namespace whose name has no
 * content hash, or null when every such file is fingerprinted.
 *
 * A Rollup content hash is a run of at least eight base64url characters appended
 * after a hyphen. Unlike a dictionary name segment (`entry`, `navigation`), a
 * real hash carries entropy, so it holds at least one digit or uppercase letter;
 * requiring that separates a hashed name from an unhashed one whatever the app or
 * another plugin named the file.
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
  const lastDash = stem.lastIndexOf("-");
  if (lastDash === -1) return false;

  const token = stem.slice(lastDash + 1);
  return (
    token.length >= 8 &&
    /^[A-Za-z0-9_-]+$/.test(token) &&
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
