import { resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { loadApplicationConfig } from "./load-application-config.js";
import { writeWorkerEntry } from "./generate-worker-entry.js";
import { writeWranglerConfig } from "./generate-wrangler-config.js";

const CLIENT_ENTRY = "src/client-entry.js";
const GENERATED_WRANGLER_CONFIG = ".goribu/wrangler.json";

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
      writeWorkerEntry({ projectRoot: root });
      const appConfig = await loadApplicationConfig({ projectRoot: root });
      writeWranglerConfig({ projectRoot: root, appConfig });
      return {
        environments: {
          client: {
            build: {
              rollupOptions: {
                input: resolve(root, CLIENT_ENTRY),
              },
            },
          },
        },
      };
    },
  };
}
