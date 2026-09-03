import { spawn as nodeSpawn } from "node:child_process";
import { resolve } from "node:path";
import { isApplicationConfig } from "../runtime/application-config.js";
import { loadApplicationConfig } from "./load-application-config.js";
import { resolveWranglerBin } from "./resolve-wrangler-bin.js";

const D1_PRICING_URL = "https://developers.cloudflare.com/d1/platform/pricing/";

/**
 * Inspect the declared production state and print a read-only deployment plan.
 *
 * The loader and remote inspector are injectable so planning behavior can be
 * exercised without credentials or network access.
 */
export async function runCheck(options) {
  const projectRoot = options?.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] runCheck({ projectRoot }) requires the application project root.",
    );
  }

  const stdout = options?.stdout ?? process.stdout;
  if (stdout === null || typeof stdout !== "object" || typeof stdout.write !== "function") {
    throw new TypeError(
      "[Goribu] runCheck({ stdout }) requires a writable output stream. Pass process.stdout or an object with write(text).",
    );
  }

  const loadConfig = options?.loadConfig ?? loadApplicationConfig;
  const inspectD1 = options?.inspectD1 ?? listRemoteD1Databases;
  const appConfig = await loadConfig({ projectRoot });
  const remoteDatabases =
    appConfig.database === undefined
      ? []
      : await inspectD1({ projectRoot });
  const plan = createCheckPlan({ appConfig, remoteDatabases });

  stdout.write(formatCheckPlan(plan));
  return plan;
}

/** Use pinned Wrangler authentication to list remote D1 databases without mutation. */
export async function listRemoteD1Databases(options) {
  const projectRoot = options?.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] listRemoteD1Databases({ projectRoot }) requires the application project root.",
    );
  }

  const spawn = options?.spawn ?? nodeSpawn;
  const resolveBin = options?.resolveBin ?? resolveWranglerBin;
  let wranglerBin;
  try {
    wranglerBin = resolveBin();
  } catch (cause) {
    throw new Error(
      "[Goribu] Could not find Wrangler, which `goribu check` uses for read-only Cloudflare inspection. Install dependencies (for example `pnpm install`) and try again.",
      { cause },
    );
  }

  let child;
  try {
    child = spawn(
      process.execPath,
      [wranglerBin, "d1", "list", "--json"],
      {
        cwd: resolve(projectRoot),
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
  } catch (cause) {
    throw wranglerStartError(cause);
  }
  if (child?.stdout === null || typeof child?.stdout?.on !== "function") {
    throw new Error(
      "[Goribu] Wrangler did not provide readable JSON output for `goribu check`. Reinstall dependencies and try again; no resources were changed.",
    );
  }

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });

  const { code, signal } = await new Promise((resolvePromise, rejectPromise) => {
    child.on("error", (cause) => rejectPromise(wranglerStartError(cause)));
    child.on("close", (exitCode, terminatingSignal) =>
      resolvePromise({ code: exitCode, signal: terminatingSignal }),
    );
  });

  if (signal !== null || code !== 0) {
    const outcome = signal !== null ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
    throw new Error(
      `[Goribu] Could not inspect D1 databases because Wrangler finished with ${outcome}. ` +
        "Read the Wrangler error above, fix authentication or account selection, then rerun `goribu check`. No resources were changed.",
    );
  }

  let databases;
  try {
    databases = JSON.parse(output);
  } catch (cause) {
    throw new Error(
      "[Goribu] Wrangler returned invalid JSON while `goribu check` inspected D1 databases. Reinstall dependencies and retry. No resources were changed.",
      { cause },
    );
  }

  return normalizeRemoteD1Databases(databases);
}

function wranglerStartError(cause) {
  return new Error(
    "[Goribu] Could not start Wrangler for the read-only D1 inspection. Reinstall dependencies and rerun `goribu check`. No resources were changed.",
    { cause },
  );
}

/** Compare one declared D1 resource with the read-only remote inventory. */
export function createCheckPlan({ appConfig, remoteDatabases } = {}) {
  if (!isApplicationConfig(appConfig)) {
    throw new TypeError(
      "[Goribu] createCheckPlan({ appConfig }) requires the defineConfig() result loaded from goribu.config.js.",
    );
  }
  const databases = normalizeRemoteD1Databases(remoteDatabases);
  const declaration = appConfig.database;
  let resources = [];
  let bindings = [];
  let costWarnings = [];

  if (declaration !== undefined) {
    const matches = databases.filter((database) => database.name === declaration.name);
    if (matches.length > 1) {
      throw new Error(
        `[Goribu] Cloudflare returned more than one D1 database named ${JSON.stringify(declaration.name)}. ` +
          "Goribu cannot choose safely; resolve the duplicate resources in Cloudflare and rerun `goribu check`. No resources were changed.",
      );
    }

    const existing = matches[0];
    resources = [
      Object.freeze({
        kind: "D1 database",
        name: declaration.name,
        state: existing === undefined ? "missing" : "existing",
        action: existing === undefined ? "create" : "none",
        id: existing?.uuid,
      }),
    ];
    bindings = [
      Object.freeze({
        name: "DB",
        resource: `D1 database ${JSON.stringify(declaration.name)}`,
      }),
    ];
    costWarnings = [
      "D1 reads, writes, and storage can incur usage charges after the account plan's included limits. " +
        `Review current pricing before deploy: ${D1_PRICING_URL}`,
    ];
  }

  return Object.freeze({
    readOnly: true,
    deployTarget: Object.freeze({
      worker: appConfig.name,
      environment: "production",
      staticAssets: "dist/client",
      compatibilityDate: appConfig.compatibilityDate,
      compatibilityFlags: appConfig.compatibilityFlags,
    }),
    resources: Object.freeze(resources),
    bindings: Object.freeze(bindings),
    costWarnings: Object.freeze(costWarnings),
  });
}

/** Render the stable, human-readable plan printed by `goribu check`. */
export function formatCheckPlan(plan) {
  const existing = plan.resources.filter((resource) => resource.state === "existing");
  const missing = plan.resources.filter((resource) => resource.state === "missing");
  const create = plan.resources.filter((resource) => resource.action === "create");
  const flags = plan.deployTarget.compatibilityFlags;
  const lines = [
    "Goribu check — read-only deployment plan",
    "",
    "Deploy target",
    `  Worker: ${plan.deployTarget.worker}`,
    `  Environment: ${plan.deployTarget.environment}`,
    `  Static assets: ${plan.deployTarget.staticAssets}`,
    `  Compatibility date: ${plan.deployTarget.compatibilityDate}`,
    `  Compatibility flags: ${flags.length === 0 ? "none" : flags.join(", ")}`,
    "",
    "Resources",
    `  Existing: ${formatResources(existing)}`,
    `  Missing: ${formatResources(missing)}`,
    `  To create on goribu deploy: ${formatResources(create)}`,
    "",
    "Bindings",
    ...(plan.bindings.length === 0
      ? ["  none"]
      : plan.bindings.map((binding) => `  ${binding.name} -> ${binding.resource}`)),
    "",
    "Cost warnings",
    ...(plan.costWarnings.length === 0
      ? ["  none"]
      : plan.costWarnings.map((warning) => `  - ${warning}`)),
    "",
    "No changes were made.",
  ];

  return `${lines.join("\n")}\n`;
}

export function normalizeRemoteD1Databases(databases) {
  if (!Array.isArray(databases)) {
    throw new TypeError(
      "[Goribu] D1 inspection must return Wrangler's database array. Rerun `goribu check`; no resources were changed.",
    );
  }

  return Object.freeze(
    databases.map((database, index) => {
      if (
        database === null ||
        typeof database !== "object" ||
        typeof database.name !== "string" ||
        database.name.length === 0 ||
        typeof database.uuid !== "string" ||
        database.uuid.length === 0
      ) {
        throw new TypeError(
          `[Goribu] Wrangler returned an invalid D1 database at index ${index}. ` +
            "Update Wrangler and rerun `goribu check`; no resources were changed.",
        );
      }
      let readReplication;
      if (
        database.read_replication !== undefined ||
        database.readReplication !== undefined
      ) {
        const mode =
          database.readReplication ?? database.read_replication?.mode;
        if (mode !== "auto" && mode !== "disabled") {
          throw new TypeError(
            `[Goribu] Wrangler returned an invalid D1 read-replication mode at index ${index}. ` +
              "Update Wrangler and rerun `goribu check`; no resources were changed.",
          );
        }
        readReplication = mode;
      }
      return Object.freeze({
        name: database.name,
        uuid: database.uuid,
        ...(readReplication === undefined ? {} : { readReplication }),
      });
    }),
  );
}

function formatResources(resources) {
  if (resources.length === 0) return "none";
  return resources
    .map((resource) => {
      const label = `${resource.kind} ${JSON.stringify(resource.name)}`;
      return resource.id === undefined ? label : `${label} (${resource.id})`;
    })
    .join(", ");
}
