import { join, resolve } from "node:path";
import { isApplicationConfig } from "../runtime/application-config.js";
import { writeGeneratedFile } from "./write-generated-file.js";

const GENERATED_DIRECTORY = ".goribu";
const WRANGLER_FILENAME = "wrangler.json";
const WORKER_FILENAME = "worker.js";
const ASSETS_BINDING = "ASSETS";
const D1_BINDING = "DB";

/**
 * Synthesize the Wrangler configuration from the application config and write it
 * to `<projectRoot>/.goribu/wrangler.json`.
 *
 * `goribu.config.js` is the single channel for deploy identity, so the app never
 * hand-writes a Wrangler file. The generated file sits next to the generated
 * Worker entry, so `main` is the sibling `worker.js`. `@cloudflare/vite-plugin`
 * reads this file (via `configPath`) and emits the deploy-ready output.
 *
 * @param {{ projectRoot: string, appConfig: object }} options
 * @returns {{ outputFile: string, config: object }}
 */
export function writeWranglerConfig(options) {
  const projectRoot = options?.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] writeWranglerConfig({ projectRoot, appConfig }) requires the application project root.",
    );
  }

  const appConfig = options?.appConfig;
  if (!isApplicationConfig(appConfig)) {
    throw new TypeError(
      "[Goribu] writeWranglerConfig({ appConfig }) requires the defineConfig() result from goribu.config.js.",
    );
  }

  const root = resolve(projectRoot);
  const outputFile = join(root, GENERATED_DIRECTORY, WRANGLER_FILENAME);
  const config = synthesizeWranglerConfig(appConfig);

  writeGeneratedFile(outputFile, `${JSON.stringify(config, null, 2)}\n`);
  return Object.freeze({ outputFile, config });
}

function synthesizeWranglerConfig(appConfig) {
  const config = {
    name: appConfig.name,
    main: WORKER_FILENAME,
    compatibility_date: appConfig.compatibilityDate,
    // drop-trailing-slash matches the Worker's own canonicalization, so a static
    // asset and a dynamically rendered route answer the same URL the same way.
    assets: { binding: ASSETS_BINDING, html_handling: "drop-trailing-slash" },
  };

  const flags = appConfig.compatibilityFlags;
  if (Array.isArray(flags) && flags.length > 0) {
    config.compatibility_flags = [...flags];
  }

  if (appConfig.database !== undefined) {
    config.d1_databases = [
      {
        binding: D1_BINDING,
        database_name: appConfig.database.name,
        // Wrangler uses the preview id as the local SQLite store key. The
        // application-authored name keeps the same local database stable while
        // Goribu owns the production UUID separately at deploy time.
        preview_database_id: appConfig.database.name,
      },
    ];
  }

  if (appConfig.kv !== undefined) {
    config.kv_namespaces = [{
      binding: "KV",
      // A stable local store key; the production id arrives only during deploy.
      preview_id: appConfig.kv.name,
    }];
  }

  return config;
}
