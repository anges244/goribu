import { readMigrations } from "./read-migrations.js";
import { formatMigrationStatus, planMigrations } from "./plan-migrations.js";
import { resolveMigrationContext } from "./migration-context.js";
import { readAppliedMigrations } from "./inspect-applied.js";
import { executeD1 } from "./wrangler-d1.js";

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
  const appliedRows = await readAppliedMigrations({ execute, shared });

  const plan = planMigrations({ migrations, appliedRows });
  stdout.write(formatMigrationStatus(target, plan));
  return plan;
}
