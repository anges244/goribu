import { updateDeployConfig } from "./update-deploy-config.js";
import { isApplicationConfig } from "../runtime/application-config.js";
import { normalizeKVNamespaces } from "./inspect-kv.js";

/** Attach the resolved production namespace to the build's single KV binding. */
export function finalizeKVBinding(options) {
  const { projectRoot, appConfig, namespace } = options ?? {};
  if (typeof projectRoot !== "string" || !projectRoot || !isApplicationConfig(appConfig) || appConfig.kv === undefined) {
    throw new TypeError("[Goribu] finalizeKVBinding requires projectRoot and a defineConfig() result with a kv declaration.");
  }
  const [validated] = normalizeKVNamespaces([namespace]);
  if (validated.title !== appConfig.kv.name) {
    throw new TypeError("[Goribu] finalizeKVBinding requires the provisioned namespace matching kv.name. Rerun `goribu deploy` to resolve the declared namespace.");
  }
  const configFile = updateDeployConfig({
    projectRoot,
    resource: "KV namespace",
    update(config, fail) {
      const bindings = config.kv_namespaces;
      if (!Array.isArray(bindings) || bindings.length !== 1 ||
          bindings[0]?.binding !== "KV" || bindings[0]?.preview_id !== appConfig.kv.name ||
          bindings[0]?.remote === true) {
        throw fail("the emitted config does not contain exactly one synthesized local KV binding matching kv.name");
      }
      bindings[0].id = validated.id;
    },
  });
  return Object.freeze({ configFile, namespaceId: validated.id });
}
