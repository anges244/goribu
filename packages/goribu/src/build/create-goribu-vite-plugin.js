import { resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { writeWorkerEntry } from "./generate-worker-entry.js";

const CLIENT_ENTRY = "src/client-entry.js";

/**
 * Compose Goribu's Vite integration.
 *
 * This is the walking skeleton: it drives the production build through the
 * Cloudflare Vite plugin so one `vite build` emits both the Worker bundle and
 * the client bundle. Goribu generates the Worker entry into `.goribu/worker.js`
 * (the app's Wrangler config names it as `main`) and points the client build at
 * `src/client-entry.js`. Routing and the dev server are added in later steps.
 */
export function goribu(options) {
  if (options !== undefined) {
    throw new TypeError(
      "[Goribu] goribu() does not accept options. Set Vite's root to the application directory and keep the client entry at src/client-entry.js.",
    );
  }

  return [createGoribuPlugin(), ...cloudflare()];
}

function createGoribuPlugin() {
  return {
    name: "goribu",
    enforce: "pre",

    config(config) {
      const root = config.root ? resolve(config.root) : process.cwd();
      // Generate the Worker entry before the Cloudflare plugin bundles `main`.
      writeWorkerEntry({ projectRoot: root });
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
