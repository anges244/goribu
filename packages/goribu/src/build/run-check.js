import { spawn as nodeSpawn } from "node:child_process";
import { join, resolve } from "node:path";
import { isApplicationConfig } from "../runtime/application-config.js";
import { loadApplicationConfig } from "./load-application-config.js";
import { resolveWranglerBin } from "./resolve-wrangler-bin.js";
import { resolveMigrationContext } from "./migrations/migration-context.js";
import { readMigrations, MIGRATIONS_DIRNAME } from "./migrations/read-migrations.js";
import { readAppliedMigrations } from "./migrations/inspect-applied.js";
import { planMigrations } from "./migrations/plan-migrations.js";
import { executeD1 } from "./migrations/wrangler-d1.js";
import { findDeclaredKVNamespace, listRemoteKVNamespaces } from "./inspect-kv.js";
import { findProductionSecretsFile, formatSecretsPlan } from "./production-secrets.js";

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
  const inspectMigrations = options?.inspectMigrations ?? inspectRemoteMigrations;
  const appConfig = await loadConfig({ projectRoot });

  const hasDatabase = appConfig.database !== undefined;
  const remoteDatabases = hasDatabase ? await inspectD1({ projectRoot }) : [];
  const inspectKV = options?.inspectKV ?? listRemoteKVNamespaces;
  const remoteNamespaces = appConfig.kv === undefined ? [] : await inspectKV({ projectRoot });

  // Read the local migration files whenever a database is declared, so the plan can
  // report pending work even before the database exists. A malformed file fails closed
  // here — a pre-deploy check must never paper over a broken migration.
  const migrations = hasDatabase
    ? readMigrations({ migrationsDir: join(resolve(projectRoot), MIGRATIONS_DIRNAME) })
    : [];

  // Only reach for the production ledger once the database is known to exist; querying a
  // database that has not been created yet would fail for the wrong reason. Existence is
  // derived from the same validated inventory the plan uses, so the two cannot disagree.
  const existing = hasDatabase
    ? findDeclaredDatabase({ appConfig, remoteDatabases })
    : undefined;
  const appliedRows =
    existing === undefined ? [] : await inspectMigrations({ projectRoot, appConfig });

  const secretsFile = findProductionSecretsFile(projectRoot);
  const plan = createCheckPlan({ appConfig, remoteDatabases, remoteNamespaces, migrations, appliedRows, secretsFile });

  stdout.write(formatCheckPlan(plan));
  return plan;
}

/**
 * Read the production migration ledger read-only, reusing the already-loaded config.
 *
 * Its Wrangler failures are labeled for `goribu check` and state that no resources were
 * changed, because this is inspection, not migration.
 */
export async function inspectRemoteMigrations(options) {
  const { projectRoot, appConfig } = options ?? {};
  const execute = options?.execute ?? executeD1;
  const context = await resolveMigrationContext({
    projectRoot,
    loadConfig: async () => appConfig,
  });
  const shared = {
    projectRoot,
    configPath: context.configPath,
    database: context.database,
    persistTo: context.persistTo,
    target: "remote",
    errorLabel: "goribu check",
    readOnly: true,
  };
  return readAppliedMigrations({ execute, shared });
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

/**
 * Find the declared database in the validated remote inventory.
 *
 * Returns the existing remote record, or undefined when the declaration has no match.
 * Both the plan and the ledger-inspection gate derive existence from here, so they can
 * never act on contradictory views of what exists.
 */
export function findDeclaredDatabase({ appConfig, remoteDatabases } = {}) {
  const declaration = appConfig?.database;
  if (declaration === undefined) return undefined;
  const databases = normalizeRemoteD1Databases(remoteDatabases);
  const matches = databases.filter((database) => database.name === declaration.name);
  if (matches.length > 1) {
    throw new Error(
      `[Goribu] Cloudflare returned more than one D1 database named ${JSON.stringify(declaration.name)}. ` +
        "Goribu cannot choose safely; resolve the duplicate resources in Cloudflare and rerun `goribu check`. No resources were changed.",
    );
  }
  return matches[0];
}

/** Compare declared resources with the read-only remote inventories. */
export function createCheckPlan({ appConfig, remoteDatabases, remoteNamespaces, migrations = [], appliedRows = [], secretsFile } = {}) {
  if (!isApplicationConfig(appConfig)) {
    throw new TypeError(
      "[Goribu] createCheckPlan({ appConfig }) requires the defineConfig() result loaded from goribu.config.js.",
    );
  }
  const declaration = appConfig.database;
  let resources = [];
  let bindings = [];
  let costWarnings = [];
  let migrationsPlan = Object.freeze({ declared: false });

  if (declaration !== undefined) {
    const existing = findDeclaredDatabase({ appConfig, remoteDatabases });
    const applied = planMigrations({ migrations, appliedRows });
    migrationsPlan = Object.freeze({
      declared: true,
      databaseExists: existing !== undefined,
      defined: migrations.length,
      applied: Object.freeze(applied.applied.map((migration) => migration.name)),
      pending: Object.freeze(applied.pending.map((migration) => migration.name)),
      drift: Object.freeze(applied.drift.map((entry) => Object.freeze({ ...entry }))),
    });
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

  if (appConfig.kv !== undefined) {
    const existing = findDeclaredKVNamespace({ appConfig, remoteNamespaces });
    resources.push(Object.freeze({
      kind: "KV namespace",
      name: appConfig.kv.name,
      state: existing === undefined ? "missing" : "existing",
      action: existing === undefined ? "create" : "none",
      id: existing?.id,
    }));
    bindings.push(Object.freeze({
      name: "KV", resource: `KV namespace ${JSON.stringify(appConfig.kv.name)}`,
    }));
    costWarnings.push(
      "KV reads, writes, deletes, lists, and storage can incur usage charges after the account plan's included limits. " +
      "Review current pricing before deploy: https://developers.cloudflare.com/kv/platform/pricing/",
    );
  }

  return Object.freeze({
    readOnly: true,
    secretsFile,
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
    migrations: migrationsPlan,
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
    `  ${formatSecretsPlan(plan.secretsFile)}`,
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
    "Migrations (production)",
    ...formatMigrations(plan.migrations),
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

/**
 * Render the production migration status: what is defined, what production has applied,
 * what remains, and any drift. The status makes deploy's schema ordering explicit: pending
 * migrations run before a new Worker is uploaded.
 */
function formatMigrations(migrations) {
  if (!migrations.declared) {
    return ["  none (no database declared)"];
  }

  const lines = [`  Defined: ${migrations.defined === 0 ? "none" : migrations.defined}`];

  // The database has not been created yet, so nothing can be applied. A ledger read never
  // happens here, so there is no applied state or drift to report — only pending work.
  if (!migrations.databaseExists) {
    if (migrations.defined > 0) {
      lines.push(
        "  Applied: unknown (the database does not exist yet)",
        `  Pending: ${migrations.pending.length} (all)`,
        ...migrations.pending.map((name) => `    - ${name}`),
      );
    }
    lines.push(
      "  goribu deploy will create the database, apply pending migrations, and then upload the Worker.",
    );
    return lines;
  }

  // The database exists: report the real applied/pending split and any drift. Drift can be
  // present even with no local files (a deleted file whose migration was already applied),
  // so it is rendered regardless of the defined count.
  lines.push(`  Applied: ${countOrNone(migrations.applied)}`);
  lines.push(...migrations.applied.map((name) => `    - ${name}`));
  lines.push(`  Pending: ${countOrNone(migrations.pending)}`);
  lines.push(...migrations.pending.map((name) => `    - ${name}`));
  if (migrations.drift.length > 0) {
    lines.push(`  Drift (${migrations.drift.length}):`);
    lines.push(...migrations.drift.map((entry) => `    - ${entry.name}: ${entry.reason}`));
    lines.push("  Resolve drift before migrating: restore the original files or add a new forward migration.");
    lines.push("  goribu deploy will refuse this drift before uploading the Worker.");
    return lines;
  }
  // Always state deploy's ordering when a database is declared, even when there is no
  // pending work. The old Worker can remain live while migrations and upload complete.
  lines.push(
    "  goribu deploy will verify migration history and apply pending migrations before uploading the Worker.",
  );
  return lines;
}

function countOrNone(names) {
  return names.length === 0 ? "none" : String(names.length);
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
