import { existsSync } from "node:fs";
import { join } from "node:path";
import { isApplicationConfig } from "../runtime/application-config.js";

/** Author Wrangler files cannot share ownership of Goribu's R2 bindings. */
export async function assertNoDuplicateR2Declaration(options) {
  const { projectRoot, appConfig } = options ?? {};
  if (typeof projectRoot !== "string" || !projectRoot || !isApplicationConfig(appConfig)) {
    throw new TypeError("[Goribu] assertNoDuplicateR2Declaration requires projectRoot and the defineConfig() result from goribu.config.js.");
  }
  if (appConfig.r2 === undefined) return;
  for (const filename of ["wrangler.json", "wrangler.jsonc", "wrangler.toml"]) {
    const configPath = join(projectRoot, filename);
    if (!existsSync(configPath)) continue;
    let rawConfig;
    try {
      const readConfig = options?.readConfig ?? (await import("wrangler")).experimental_readRawConfig;
      ({ rawConfig } = readConfig({ config: configPath }));
    } catch (cause) {
      throw new Error(
        `[Goribu] Could not inspect ${filename} for a duplicate R2 declaration. Fix or remove that Wrangler config, then rebuild; Goribu must prove bucket bindings have one owner.`,
        { cause },
      );
    }
    const scopes = [rawConfig, ...Object.values(rawConfig?.env ?? {})];
    if (scopes.some((scope) => scope != null && Object.hasOwn(scope, "r2_buckets"))) {
      throw new Error(
        `[Goribu] ${filename} declares r2_buckets while goribu.config.js also declares r2. Remove the r2_buckets declaration from the Wrangler file; Goribu owns the R2 and R2_PRIVATE bindings and supports at most two managed buckets through r2 configuration.`,
      );
    }
  }
}
