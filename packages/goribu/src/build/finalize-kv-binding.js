import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
  const root = resolve(projectRoot);
  const redirectFile = join(root, ".wrangler", "deploy", "config.json");
  const redirect = readJson(redirectFile);
  if (typeof redirect?.configPath !== "string" || !redirect.configPath) {
    throw outputError("the deploy redirect has no configPath");
  }
  const configFile = resolve(dirname(redirectFile), redirect.configPath);
  const fromRoot = relative(root, configFile);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw outputError("the deploy redirect points outside the application");
  }
  const config = readJson(configFile);
  const bindings = config?.kv_namespaces;
  if (
    !Array.isArray(bindings) || bindings.length !== 1 ||
    bindings[0]?.binding !== "KV" || bindings[0]?.preview_id !== appConfig.kv.name ||
    bindings[0]?.remote === true
  ) {
    throw outputError("the emitted config does not contain exactly one synthesized local KV binding matching kv.name");
  }
  bindings[0].id = validated.id;
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return Object.freeze({ configFile, namespaceId: validated.id });
}

function readJson(filename) {
  try { return JSON.parse(readFileSync(filename, "utf8")); }
  catch (cause) { throw outputError("the build output could not be read", cause); }
}

function outputError(detail, cause) {
  return new Error(
    `[Goribu] Cannot attach the provisioned KV namespace because ${detail}. Run \`goribu build\` again; if the output is still invalid, update Goribu before retrying \`goribu deploy\`.`,
    { cause },
  );
}
