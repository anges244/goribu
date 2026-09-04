import { existsSync } from "node:fs";
import { join } from "node:path";
import { isApplicationConfig } from "../runtime/application-config.js";

/** Author Wrangler files cannot share ownership of Goribu's KV binding. */
export async function assertNoDuplicateKVDeclaration(options) {
  const { projectRoot, appConfig } = options ?? {};
  if (typeof projectRoot !== "string" || !projectRoot || !isApplicationConfig(appConfig)) {
    throw new TypeError("[Goribu] assertNoDuplicateKVDeclaration requires projectRoot and the defineConfig() result from goribu.config.js.");
  }
  if (appConfig.kv === undefined) return;
  for (const filename of ["wrangler.json", "wrangler.jsonc", "wrangler.toml"]) {
    const configPath = join(projectRoot, filename);
    if (!existsSync(configPath)) continue;
    let rawConfig;
    try {
      const readConfig = options?.readConfig ?? (await import("wrangler")).experimental_readRawConfig;
      ({ rawConfig } = readConfig({ config: configPath }));
    } catch (cause) {
      throw new Error(
        `[Goribu] Could not inspect ${filename} for a duplicate KV declaration. Fix or remove that Wrangler config, then rebuild; Goribu must prove namespace bindings have one owner.`,
        { cause },
      );
    }
    const scopes = [rawConfig, ...Object.values(rawConfig?.env ?? {})];
    if (scopes.some((scope) => scope != null && Object.hasOwn(scope, "kv_namespaces"))) {
      throw new Error(
        `[Goribu] ${filename} declares kv_namespaces while goribu.config.js also declares kv. Remove the kv_namespaces declaration from the Wrangler file; Goribu owns and synthesizes the KV binding from kv.name.`,
      );
    }
  }
}
