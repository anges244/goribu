import { existsSync } from "node:fs";
import { join } from "node:path";
import { isApplicationConfig } from "../../runtime/application-config.js";

/** Author Wrangler files cannot share ownership of Goribu's Postgres bindings. */
export async function assertNoDuplicateHyperdriveDeclaration(options) {
  const { projectRoot, appConfig } = options ?? {};
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError("[Goribu] assertNoDuplicateHyperdriveDeclaration({ projectRoot, appConfig }) requires the application project root.");
  }
  if (!isApplicationConfig(appConfig)) {
    throw new TypeError("[Goribu] assertNoDuplicateHyperdriveDeclaration({ appConfig }) requires the defineConfig() result from goribu.config.js.");
  }
  if (appConfig.database?.type !== "postgres") return;
  for (const filename of ["wrangler.json", "wrangler.jsonc", "wrangler.toml"]) {
    const configPath = join(projectRoot, filename);
    if (!existsSync(configPath)) continue;
    let rawConfig;
    try {
      const readConfig = options?.readConfig ?? (await import("wrangler")).experimental_readRawConfig;
      ({ rawConfig } = readConfig({ config: configPath }));
    } catch (cause) {
      throw new Error(
        `[Goribu] Could not inspect ${filename} for a duplicate Hyperdrive declaration. Fix or remove that Wrangler config, then rebuild; Goribu must prove that database bindings have one owner before it can build.`,
        { cause },
      );
    }
    const scopes = [rawConfig, ...Object.values(rawConfig?.env ?? {})];
    if (scopes.some((scope) => scope != null && Object.hasOwn(scope, "hyperdrive"))) {
      throw new Error(
        `[Goribu] ${filename} declares hyperdrive while goribu.config.js declares a Postgres database. Remove the hyperdrive entry; Goribu owns the POSTGRES and POSTGRES_CACHED bindings. To use existing Hyperdrive configs, set hyperdriveId and hyperdriveCachedId in goribu.config.js.`,
      );
    }
  }
}
