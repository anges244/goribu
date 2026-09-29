import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Both resource finalizers update the same build artifact through this boundary. */
export function updateDeployConfig({ projectRoot, resource, update }) {
  function fail(detail, cause) {
    return new Error(
      `[Goribu] Cannot attach the provisioned ${resource} because ${detail}. ` +
      "Run `goribu build` again; if the output is still invalid, update Goribu before retrying `goribu deploy`.",
      { cause },
    );
  }
  const { config, configFile, realConfig } = readDeployConfig({ projectRoot, fail });
  update(config, fail);
  writeFileSync(realConfig, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configFile;
}

/** Read the generated redirect and config without modifying build output. */
export function readDeployConfig({ projectRoot, fail, optional = false }) {
  function readJson(path, label) {
    try { return JSON.parse(readFileSync(path, "utf8")); }
    catch (cause) {
      if (optional && cause.code === "ENOENT") return undefined;
      throw fail(`could not read ${label}`, cause);
    }
  }
  const root = resolve(projectRoot);
  const redirectFile = join(root, ".wrangler", "deploy", "config.json");
  const redirect = readJson(redirectFile, "the Wrangler deploy redirect");
  if (redirect === undefined && optional) return null;
  if (typeof redirect?.configPath !== "string" || !redirect.configPath) {
    throw fail("the Wrangler deploy redirect has no configPath");
  }
  const configFile = resolve(dirname(redirectFile), redirect.configPath);
  function contained(parent, child) {
    const path = relative(parent, child);
    return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
  }
  if (!contained(root, configFile)) {
    throw fail("the Wrangler deploy redirect points outside the application");
  }
  // Lexical containment alone allows a symlink to redirect the write elsewhere.
  let realRoot, realConfig;
  try {
    realRoot = realpathSync(root);
    realConfig = realpathSync(configFile);
  } catch (cause) {
    if (optional && cause.code === "ENOENT") return null;
    throw fail("the emitted Wrangler config cannot be resolved", cause);
  }
  if (!contained(realRoot, realConfig)) {
    throw fail("the emitted Wrangler config resolves outside the application");
  }
  const config = readJson(realConfig, "the emitted Wrangler config");
  if (config === undefined && optional) return null;
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw fail("the emitted Wrangler config is not an object");
  }
  return { config, configFile, realConfig };
}
