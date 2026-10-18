import { join, resolve } from "node:path";
import { MIGRATIONS_DIRNAME, TRACKING_TABLE, readMigrations } from "../migrations/read-migrations.js";
import { formatMigrationStatus, planMigrations } from "../migrations/plan-migrations.js";
import { connectMigrationDatabase } from "./connect-migration-database.js";

/**
 * Read-only by contract: no lock or CREATE, and a missing ledger means everything
 * is pending. Drift is reported, not thrown, as in the D1 status command.
 */
export async function runPostgresMigrateStatus({ projectRoot, target = "local", stdout = process.stdout, loadConfig }) {
  const migrations = readMigrations({ migrationsDir: join(resolve(projectRoot), MIGRATIONS_DIRNAME) });
  const sql = await connectMigrationDatabase({ projectRoot, target, loadConfig });
  try {
    const [{ exists }] = await sql`SELECT to_regclass(${TRACKING_TABLE}) IS NOT NULL AS exists`;
    const rows = exists ? await sql`SELECT name, checksum FROM ${sql(TRACKING_TABLE)} ORDER BY name` : [];
    const appliedRows = rows.map((row) => ({ name: String(row.name), checksum: String(row.checksum) }));
    const plan = planMigrations({ migrations, appliedRows });
    stdout.write(formatMigrationStatus(target, plan));
    return plan;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
