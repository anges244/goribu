import { readMigrations, TRACKING_TABLE } from "./read-migrations.js";
import { planMigrations } from "./plan-migrations.js";
import { resolveMigrationContext } from "./migration-context.js";
import { executeD1, lastResultRows } from "./wrangler-d1.js";

const TABLE_EXISTS =
  `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${TRACKING_TABLE}'`;

/**
 * Print applied, pending, and drifted migrations for the target without changing anything.
 *
 * Read-only by contract: it inspects `sqlite_master` first and never creates the tracking
 * table, so asking for status can never leave a side effect behind. Drift is surfaced here
 * as information — this is the command you run to see it — rather than raised as an error.
 *
 * @param {{ projectRoot: string, target?: "local" | "remote", stdout?: { write(text: string): void }, loadConfig?: Function, execute?: Function }} options
 */
export async function runMigrateStatus(options) {
  const target = options?.target ?? "local";
  const stdout = options?.stdout ?? process.stdout;
  const execute = options?.execute ?? executeD1;
  const context = await resolveMigrationContext({
    projectRoot: options?.projectRoot,
    loadConfig: options?.loadConfig,
  });
  const shared = {
    projectRoot: options.projectRoot,
    configPath: context.configPath,
    database: context.database,
    persistTo: context.persistTo,
    target,
  };

  const migrations = readMigrations({ migrationsDir: context.migrationsDir });

  const existence = await execute({ ...shared, command: TABLE_EXISTS, json: true });
  let appliedRows = [];
  if (lastResultRows(existence).length > 0) {
    const appliedResult = await execute({
      ...shared,
      command: `SELECT name, checksum FROM ${TRACKING_TABLE} ORDER BY name`,
      json: true,
    });
    appliedRows = lastResultRows(appliedResult).map((row) => ({
      name: String(row.name),
      checksum: String(row.checksum),
    }));
  }

  const plan = planMigrations({ migrations, appliedRows });
  stdout.write(formatStatus(target, plan));
  return plan;
}

function formatStatus(target, plan) {
  const lines = [
    `Goribu migrations — ${target}`,
    "",
    `Applied (${plan.applied.length}):`,
    ...listOrNone(plan.applied.map((migration) => migration.name)),
    "",
    `Pending (${plan.pending.length}):`,
    ...listOrNone(plan.pending.map((migration) => migration.name)),
  ];
  if (plan.drift.length > 0) {
    lines.push("", `Drift (${plan.drift.length}):`);
    for (const { name, reason } of plan.drift) {
      lines.push(`  - ${name}: ${reason}`);
    }
    lines.push(
      "",
      "Resolve drift before running migrations: restore the original files or add a new forward migration.",
    );
  }
  return `${lines.join("\n")}\n`;
}

function listOrNone(names) {
  return names.length === 0 ? ["  none"] : names.map((name) => `  - ${name}`);
}
