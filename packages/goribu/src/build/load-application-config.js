import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isApplicationConfig } from "../runtime/application-config.js";

export const APPLICATION_CONFIG_FILENAME = "goribu.config.js";

/**
 * Load and validate the application's `goribu.config.js`.
 *
 * The file must default-export the result of `defineConfig(...)`. This is the
 * single author-owned configuration channel; the build reads it here to
 * synthesize the Wrangler configuration, so a missing, unreadable, or
 * un-branded config fails closed with a teaching error.
 *
 * @param {{ projectRoot: string }} options
 * @returns {Promise<object>} the branded application config
 */
export async function loadApplicationConfig(options) {
  const projectRoot = options?.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] loadApplicationConfig({ projectRoot }) requires the application project root.",
    );
  }

  const root = resolve(projectRoot);
  const configFile = join(root, APPLICATION_CONFIG_FILENAME);

  let stats;
  try {
    stats = statSync(configFile);
  } catch (cause) {
    if (cause?.code === "ENOENT") {
      throw new Error(
        `[Goribu] Cannot build because ${JSON.stringify(configFile)} is missing. ` +
          `Create ${APPLICATION_CONFIG_FILENAME} that default-exports defineConfig({ name, compatibilityDate }).`,
        { cause },
      );
    }
    throw new Error(
      `[Goribu] Could not inspect ${JSON.stringify(configFile)}. ` +
        `Make sure the project directory is readable and try again. ${cause.message}`,
      { cause },
    );
  }

  if (!stats.isFile()) {
    throw new Error(
      `[Goribu] Cannot build because ${JSON.stringify(configFile)} is not a regular file. ` +
        `Replace it with ${APPLICATION_CONFIG_FILENAME} that default-exports defineConfig({ name, compatibilityDate }).`,
    );
  }

  let module;
  try {
    // Node caches an ES module for the lifetime of the process, so a long-lived
    // `goribu dev` would keep serving the config it read at startup. The file's
    // modification time makes the specifier change exactly when the file does:
    // an edit is picked up on the next restart, and an unrelated restart reuses
    // the cached module instead of leaking a new one.
    const specifier = `${pathToFileURL(configFile).href}?mtime=${stats.mtimeMs}`;
    module = await import(specifier);
  } catch (cause) {
    throw new Error(
      `[Goribu] Could not load ${JSON.stringify(configFile)}. ${cause.message}`,
      { cause },
    );
  }

  const config = module?.default;
  if (!isApplicationConfig(config)) {
    throw new Error(
      `[Goribu] ${JSON.stringify(configFile)} must default-export the result of defineConfig(...). ` +
        "Wrap the configuration: export default defineConfig({ name, compatibilityDate }).",
    );
  }

  return config;
}
