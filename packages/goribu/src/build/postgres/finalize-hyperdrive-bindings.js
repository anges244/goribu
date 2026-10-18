import { isApplicationConfig } from "../../runtime/application-config.js";
import {
  GORIBU_HYPERDRIVE_PLACEHOLDER,
  GORIBU_HYPERDRIVE_CACHED_PLACEHOLDER,
} from "../generate-wrangler-config.js";
import { updateDeployConfig } from "../update-deploy-config.js";

/** Attach the resolved IDs to the build's two synthesized Hyperdrive bindings. */
export function finalizeHyperdriveBindings(options) {
  const { projectRoot, appConfig, hyperdrive } = options ?? {};
  if (typeof projectRoot !== "string" || !projectRoot || !isApplicationConfig(appConfig) ||
      appConfig.database?.type !== "postgres") {
    throw new TypeError("[Goribu] finalizeHyperdriveBindings requires projectRoot and a defineConfig() result with a Postgres database declaration.");
  }
  const { id, cachedId } = hyperdrive ?? {};
  const placeholders = [GORIBU_HYPERDRIVE_PLACEHOLDER, GORIBU_HYPERDRIVE_CACHED_PLACEHOLDER];
  if ([id, cachedId].some((value) => typeof value !== "string" || !/^[a-f0-9]{32}$/i.test(value) || placeholders.includes(value)) ||
      id === cachedId) {
    throw new TypeError("[Goribu] finalizeHyperdriveBindings requires two distinct, resolved 32-character hexadecimal Hyperdrive IDs. Rerun `goribu deploy` to provision or validate both configs.");
  }
  const database = appConfig.database;
  if (database.hyperdriveId !== undefined &&
      (id !== database.hyperdriveId || cachedId !== database.hyperdriveCachedId)) {
    throw new TypeError("[Goribu] The resolved Hyperdrive IDs do not match hyperdriveId and hyperdriveCachedId in goribu.config.js. Rerun `goribu deploy` to validate the declared configs.");
  }
  const expected = [
    { binding: "POSTGRES", id: database.hyperdriveId ?? GORIBU_HYPERDRIVE_PLACEHOLDER, resolved: id },
    { binding: "POSTGRES_CACHED", id: database.hyperdriveCachedId ?? GORIBU_HYPERDRIVE_CACHED_PLACEHOLDER, resolved: cachedId },
  ];
  let configFile;
  try {
    configFile = updateDeployConfig({
      projectRoot,
      resource: "Hyperdrive configs",
      update(config, fail) {
        const bindings = config.hyperdrive;
        if (!Array.isArray(bindings) || bindings.length !== 2 || expected.some((entry) => {
          const matches = bindings.filter((binding) => binding?.binding === entry.binding);
          const binding = matches[0];
          return matches.length !== 1 || binding.id !== entry.id ||
            Object.keys(binding).some((key) => key !== "binding" && key !== "id");
        })) {
          throw fail("the emitted config does not contain exactly the two synthesized POSTGRES and POSTGRES_CACHED bindings with their expected IDs and no extra fields");
        }
        for (const entry of expected) {
          bindings.find((binding) => binding.binding === entry.binding).id = entry.resolved;
        }
      },
    });
  } catch (error) {
    // The shared reader retains JSON parser causes, which can quote file contents.
    if (error.message?.startsWith("[Goribu] Cannot attach the provisioned Hyperdrive configs because ")) {
      throw new Error(error.message);
    }
    throw new Error("[Goribu] Could not write the Hyperdrive deploy bindings. Make the emitted config writable and run `goribu build` again before retrying `goribu deploy`.");
  }
  return Object.freeze({ configFile, id, cachedId });
}
