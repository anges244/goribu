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
 * Apply every pending migration in order against the target D1 database.
 *
 * Each migration's forward SQL and its ledger row are written to one file and run as
 * one Wrangler batch, so a failed migration records nothing and is safe to retry. The
 * command refuses to touch the database while any drift exists.
 *
 * @param {{ projectRoot: string, target?: "local" | "remote", stdout?: { write(text: string): void }, loadConfig?: Function, execute?: Function, errorLabel?: string }} options
 */
export async function runMigrate(options) {
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
    ...(options?.errorLabel === undefined ? {} : { errorLabel: options.errorLabel }),
  };

  const migrations = readMigrations({ migrationsDir: context.migrationsDir });

  // Preflight, before the tracking table exists or any SQL runs: an empty scaffold must
  // never be recorded as applied, because filling it in afterwards would drift its checksum.
  const empty = migrations.find((migration) => migration.upSql.length === 0);
  if (empty !== undefined) {
    throw new Error(
      `[Goribu] Migration ${empty.name} has no SQL under -- migrate:up. ` +
        "Add its forward SQL before migrating, or delete the file. Applying an empty scaffold " +
        "now and writing its SQL later would drift the recorded checksum.",
    );
  }

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
  if (plan.pending.length === 0) {
    stdout.write(`Already up to date on ${target} (${plan.applied.length} applied).\n`);
    return plan;
  }

  const workDir = mkdtempSync(join(tmpdir(), "goribu-migrate-"));
  try {
    for (const migration of plan.pending) {
      const file = join(workDir, `${migration.name}.sql`);
      writeFileSync(file, buildApplyFile(migration), "utf8");
      await execute({ ...shared, file });
      stdout.write(`✓ Applied ${migration.name} to ${target}\n`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  return plan;
}

/**
 * One file per migration: forward SQL followed by the ledger insert. Wrangler runs a
 * file as a single batch, so recording an applied migration cannot outlive its own SQL.
 */
function buildApplyFile(migration) {
  const forward = migration.upSql.trimEnd();
  const prefix =
    forward.length === 0 ? "" : forward.endsWith(";") ? `${forward}\n` : `${forward};\n`;
  const ledger =
    `INSERT INTO ${TRACKING_TABLE} (name, checksum) ` +
    `VALUES ('${migration.name}', '${migration.checksum}');\n`;
  return `${prefix}${ledger}`;
}
