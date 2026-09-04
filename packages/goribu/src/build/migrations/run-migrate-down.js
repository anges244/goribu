import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMigrations, TRACKING_TABLE } from "./read-migrations.js";
import { describeDrift, planMigrations } from "./plan-migrations.js";
import { resolveMigrationContext } from "./migration-context.js";
import { executeD1, lastResultRows } from "./wrangler-d1.js";

const CREATE_TRACKING_TABLE =
  `CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (` +
  "name TEXT PRIMARY KEY, " +
  "checksum TEXT NOT NULL, " +
  "applied_at TEXT NOT NULL DEFAULT (datetime('now'))" +
  ")";

/**
 * Roll back exactly the last applied migration on the target D1 database.
 *
 * The migration's down SQL and ledger deletion run as one Wrangler batch, so a
 * failed rollback leaves the migration recorded. Drift and an empty down section
 * both fail closed before any rollback SQL runs.
 *
 * @param {{ projectRoot: string, target?: "local" | "remote", stdout?: { write(text: string): void }, loadConfig?: Function, execute?: Function }} options
 */
export async function runMigrateDown(options) {
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
  await execute({ ...shared, command: CREATE_TRACKING_TABLE });
  const appliedResult = await execute({
    ...shared,
    command: `SELECT name, checksum FROM ${TRACKING_TABLE} ORDER BY name`,
    json: true,
  });
  const appliedRows = lastResultRows(appliedResult).map((row) => ({
    name: String(row.name),
    checksum: String(row.checksum),
  }));

  const plan = planMigrations({ migrations, appliedRows });
  if (plan.drift.length > 0) {
    throw new Error(describeDrift(plan.drift));
  }

  const migration = plan.applied.at(-1);
  if (migration === undefined) {
    stdout.write(`Nothing to roll back on ${target} (0 applied).\n`);
    return plan;
  }
  if (migration.downSql.length === 0) {
    throw new Error(
      `[Goribu] Migration ${migration.name} declared no rollback under -- migrate:down. ` +
        "This migration cannot be rolled back honestly; write a new forward migration to undo it.",
    );
  }

  const workDir = mkdtempSync(join(tmpdir(), "goribu-migrate-down-"));
  try {
    const file = join(workDir, `${migration.name}.sql`);
    writeFileSync(file, buildRollbackFile(migration), "utf8");
    await execute({ ...shared, file });
    stdout.write(`✓ Rolled back ${migration.name} from ${target}\n`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  return plan;
}

/** Keep rollback SQL and its ledger deletion in one D1 transaction. */
function buildRollbackFile(migration) {
  const rollback = migration.downSql.trimEnd();
  const prefix = rollback.endsWith(";") ? `${rollback}\n` : `${rollback};\n`;
  return `${prefix}DELETE FROM ${TRACKING_TABLE} WHERE name = '${migration.name}';\n`;
}
