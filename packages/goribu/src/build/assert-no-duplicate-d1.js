import { existsSync } from "node:fs";
import { join } from "node:path";
import { isApplicationConfig } from "../runtime/application-config.js";

const WRANGLER_CONFIG_FILES = [
  "wrangler.json",
  "wrangler.jsonc",
  "wrangler.toml",
];

/**
 * Fail before a build when an app declares D1 through both Goribu and Wrangler.
 *
 * Goribu's generated `goribu.wrangler.jsonc` is deliberately outside this
 * search. These are author-owned root files, which would otherwise create a
 * second source of truth for the `DB` binding.
 */
export async function assertNoDuplicateD1Declaration(options) {
  const projectRoot = options?.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] assertNoDuplicateD1Declaration({ projectRoot, appConfig }) requires the application project root.",
    );
  }

  const appConfig = options?.appConfig;
  if (!isApplicationConfig(appConfig)) {
    throw new TypeError(
      "[Goribu] assertNoDuplicateD1Declaration({ appConfig }) requires the defineConfig() result from goribu.config.js.",
    );
  }
  if (appConfig.database?.type !== "d1") return;

  for (const filename of WRANGLER_CONFIG_FILES) {
    const configPath = join(projectRoot, filename);
    if (!existsSync(configPath)) continue;

    let rawConfig;
    try {
      const readConfig =
        options?.readConfig ??
        (await import("wrangler")).experimental_readRawConfig;
      ({ rawConfig } = readConfig({ config: configPath }));
    } catch (cause) {
      throw new Error(
        `[Goribu] Could not inspect ${filename} for a duplicate D1 declaration. ` +
          "Fix or remove that Wrangler config, then rebuild; Goribu must prove that database bindings have one owner before it can build.",
        { cause },
      );
    }

    if (findD1Declaration(rawConfig) !== null) {
      throw new Error(
        `[Goribu] ${filename} declares d1_databases while goribu.config.js also declares database. ` +
          "Remove the d1_databases declaration from the Wrangler file; Goribu owns and synthesizes the DB binding from database.name.",
      );
    }
  }
}

function findD1Declaration(rawConfig) {
  if (hasOwn(rawConfig, "d1_databases")) return "d1_databases";
  const environments = rawConfig?.env;
  if (environments === null || typeof environments !== "object") return null;

  for (const environment of Object.values(environments)) {
    if (hasOwn(environment, "d1_databases")) return "env.*.d1_databases";
  }
  return null;
}

function hasOwn(value, key) {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, key)
  );
}
