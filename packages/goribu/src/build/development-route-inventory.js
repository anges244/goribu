import { isAbsolute, relative, resolve, sep } from "node:path";
import { generateManifest } from "../routing/generate-manifest.js";
import { scanDocument } from "../routing/scan-document.js";
import { scanErrorPages } from "../routing/scan-error-pages.js";
import { isRouteFile } from "../routing/scan-routes.js";
import { selectMiddlewareByRoute } from "./select-middleware-by-route.js";

/** Refresh the generated Worker and browser inventories together when routes change. */
export function createDevelopmentRouteInventoryPlugin() {
  let projectRoot;
  let routesDir;
  let configuredInventory;

  return {
    name: "goribu:development-route-inventory",
    apply: "serve",
    enforce: "pre",

    // Run before Goribu's generators. Checking this baseline after listening
    // catches edits made while the replacement server was being constructed.
    config(config) {
      projectRoot = resolve(config.root ?? process.cwd());
      routesDir = resolve(projectRoot, "src/routes");
      configuredInventory = readInventory(projectRoot, routesDir);
    },

    configureServer(server) {
      let timer;
      let closed = false;
      let listening = server.httpServer === null || server.httpServer?.listening;
      let checking = false;
      let checkAgain = false;

      function schedule() {
        if (closed || !listening) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          check().catch((error) => server.config.logger.error(
            `[Goribu] Could not refresh development routes: ${error?.message ?? error}. Fix the error and restart \`goribu dev\`.`,
          ));
        }, 100);
      }

      async function check() {
        if (closed) return;
        if (checking) {
          checkAgain = true;
          return;
        }
        checking = true;
        try {
          let current;
          try {
            current = readInventory(projectRoot, routesDir);
          } catch {
            // The existing validated restart reports invalid/unfinished route
            // edits without tearing down the current development session.
          }
          if (current === configuredInventory) return;
          server.config.logger.info("[Goribu] Route inventory changed, restarting server...", {
            timestamp: true,
          });
          await server.restart();
        } finally {
          checking = false;
          if (checkAgain) {
            checkAgain = false;
            schedule();
          }
        }
      }

      function onFile(event, file) {
        if (!["add", "unlink", "change", "addDir", "unlinkDir"].includes(event)) return;
        const path = relative(routesDir, resolve(file));
        if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) return;
        if (event !== "addDir" && event !== "unlinkDir" && !isRouteFile(file)) return;
        schedule();
      }
      function onListening() {
        listening = true;
        schedule();
      }

      server.watcher.on("all", onFile);
      server.httpServer?.once("listening", onListening);
      schedule();

      // Also clean up servers abandoned during another plugin's setup hook.
      const close = server.close.bind(server);
      server.close = async () => {
        closed = true;
        clearTimeout(timer);
        server.watcher.off("all", onFile);
        server.httpServer?.off("listening", onListening);
        return close();
      };
    },
  };
}

function readInventory(projectRoot, routesDir) {
  const manifest = generateManifest({ projectRoot, routesDir });
  return JSON.stringify({
    manifest,
    document: scanDocument(routesDir),
    errorPages: scanErrorPages(routesDir),
    middleware: [...selectMiddlewareByRoute({ projectRoot, routesDir, manifest })],
  });
}
