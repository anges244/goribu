import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isApplicationConfig } from "../runtime/application-config.js";

const DEPLOY_REDIRECT = join(".wrangler", "deploy", "config.json");

/** Put the provisioned UUID into the deploy config emitted by the Vite build. */
export function finalizeD1Binding(options) {
  const projectRoot = options?.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] finalizeD1Binding({ projectRoot }) requires the application project root.",
    );
  }
  const appConfig = options?.appConfig;
  if (!isApplicationConfig(appConfig) || appConfig.database === undefined) {
    throw new TypeError(
      "[Goribu] finalizeD1Binding({ appConfig }) requires a defineConfig() result with a database declaration.",
    );
  }
  const database = options?.database;
  if (
    database === null ||
    typeof database !== "object" ||
    database.name !== appConfig.database.name ||
    typeof database.uuid !== "string" ||
    database.uuid.length === 0
  ) {
    throw new TypeError(
      "[Goribu] finalizeD1Binding({ database }) requires the provisioned D1 database matching database.name.",
    );
  }

  const root = resolve(projectRoot);
  const redirectFile = join(root, DEPLOY_REDIRECT);
  const redirect = readJson(
    redirectFile,
    "the Wrangler deploy redirect",
  );
  if (typeof redirect?.configPath !== "string" || redirect.configPath.length === 0) {
    throw buildOutputError("the Wrangler deploy redirect has no configPath");
  }

  const deployConfigFile = resolve(dirname(redirectFile), redirect.configPath);
  const fromRoot = relative(root, deployConfigFile);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw buildOutputError("the Wrangler deploy redirect points outside the application");
  }
  const deployConfig = readJson(deployConfigFile, "the emitted Wrangler config");
  const declarations = Array.isArray(deployConfig.d1_databases)
    ? deployConfig.d1_databases.filter(
        (binding) =>
          binding?.binding === "DB" &&
          binding?.database_name === appConfig.database.name,
      )
    : [];
  if (declarations.length !== 1 || deployConfig.d1_databases.length !== 1) {
    throw buildOutputError(
      "the emitted Wrangler config does not contain exactly one synthesized DB binding",
    );
  }

  declarations[0].database_id = database.uuid;
  writeFileSync(
    deployConfigFile,
    `${JSON.stringify(deployConfig, null, 2)}\n`,
    "utf8",
  );
  return Object.freeze({ configFile: deployConfigFile, databaseId: database.uuid });
}

function readJson(filename, label) {
  try {
    return JSON.parse(readFileSync(filename, "utf8"));
  } catch (cause) {
    throw buildOutputError(`could not read ${label}`, cause);
  }
}

function buildOutputError(detail, cause) {
  return new Error(
    `[Goribu] Cannot attach the provisioned D1 database because ${detail}. ` +
      "Run `goribu build` again; if the output is still invalid, update Goribu before retrying `goribu deploy`.",
    { cause },
  );
}
