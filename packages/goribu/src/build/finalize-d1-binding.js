import { updateDeployConfig } from "./update-deploy-config.js";
import { isApplicationConfig } from "../runtime/application-config.js";

/** Put the provisioned UUID into the deploy config emitted by the Vite build. */
export function finalizeD1Binding(options) {
  const projectRoot = options?.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] finalizeD1Binding({ projectRoot }) requires the application project root.",
    );
  }
  const appConfig = options?.appConfig;
  if (!isApplicationConfig(appConfig) || appConfig.database?.type !== "d1") {
    throw new TypeError(
      "[Goribu] finalizeD1Binding({ appConfig }) requires a defineConfig() result with a D1 database declaration. Set database: { type: \"d1\", name: \"your-db-name\" } in goribu.config.js.",
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

  const configFile = updateDeployConfig({
    projectRoot,
    resource: "D1 database",
    update(config, fail) {
      const bindings = config.d1_databases;
      if (!Array.isArray(bindings) || bindings.length !== 1 ||
          bindings[0]?.binding !== "DB" || bindings[0]?.database_name !== appConfig.database.name) {
        throw fail("the emitted Wrangler config does not contain exactly one synthesized DB binding");
      }
      bindings[0].database_id = database.uuid;
    },
  });
  return Object.freeze({ configFile, databaseId: database.uuid });
}
