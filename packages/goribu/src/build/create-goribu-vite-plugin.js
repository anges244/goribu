import { resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";

const CLIENT_ENTRY = "src/client-entry.js";

/**
 * Compose Goribu's Vite integration.
 *
 * This is the walking skeleton: it drives the production build through the
 * Cloudflare Vite plugin so one `vite build` emits both the Worker bundle and
 * the client bundle. The Cloudflare plugin discovers the app's Wrangler config
 * (its `main` names the Worker entry); Goribu points the client build at
 * `src/client-entry.js`. Routing, the generated Worker entry, and the dev server
 * are added in later steps.
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
