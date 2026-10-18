import postgres from "postgres";
import { join, resolve } from "node:path";
import { MIGRATIONS_DIRNAME, TRACKING_TABLE, readMigrations } from "../migrations/read-migrations.js";
import { assertNoEmptyMigrations, describeDrift, planMigrations } from "../migrations/plan-migrations.js";
import { connectMigrationDatabase } from "./connect-migration-database.js";

// The ledger is one table per database, so the lock is per database, not per app.
const LOCK_NAME = "goribu:migrations";

/** Apply pending files over one direct Postgres session under an advisory lock. */
export async function runPostgresMigrate({ projectRoot, target = "local", stdout = process.stdout, loadConfig }) {
  const migrations = readMigrations({ migrationsDir: join(resolve(projectRoot), MIGRATIONS_DIRNAME) });
  assertNoEmptyMigrations(migrations);
  const sql = await connectMigrationDatabase({ projectRoot, target, loadConfig });
  try {
    const [{ locked }] = await sql`SELECT pg_try_advisory_lock(hashtext(${LOCK_NAME})) AS locked`;
    if (!locked) {
      stdout.write(`Waiting for another migration run on this ${target} database to finish…\n`);
      await sql`SELECT pg_advisory_lock(hashtext(${LOCK_NAME}))`;
    }
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    const appliedRows = await sql`SELECT name, checksum FROM ${sql(TRACKING_TABLE)} ORDER BY name`;
    const plan = planMigrations({ migrations, appliedRows });
    if (plan.drift.length > 0) throw new Error(describeDrift(plan.drift));
    if (plan.pending.length === 0) {
      stdout.write(`Already up to date on ${target} (${plan.applied.length} applied).\n`);
      return plan;
    }
    for (const migration of plan.pending) {
      try {
        // unsafe without parameters uses the simple protocol, allowing several
        // statements in one string. Postgres runs them as one implicit transaction,
        // so a no-transaction migration must hold exactly one statement.
        const apply = async (tx) => {
          await tx.unsafe(migration.upSql);
          await tx`INSERT INTO ${tx(TRACKING_TABLE)} (name, checksum) VALUES (${migration.name}, ${migration.checksum})`;
        };
        if (migration.transaction) await sql.begin(apply);
        else await apply(sql);
      } catch (cause) {
        const detail = cause.message || cause.code || String(cause);
        const code = cause instanceof postgres.PostgresError ? cause.code : undefined;
        const sentences = [
          `[Goribu] Migration ${migration.name} failed on ${target}: ${detail}${code ? ` (Postgres ${code})` : ""}.`,
          migration.transaction
            ? "It ran in a transaction, so none of its changes and no ledger row were kept."
            : "It ran without a transaction (-- goribu:no-transaction), so check what the statement left behind before retrying. A failed CREATE INDEX CONCURRENTLY leaves an INVALID index; drop it with DROP INDEX CONCURRENTLY IF EXISTS.",
        ];
        if (code === "25001") {
          sentences.push(migration.transaction
            ? "This statement cannot run inside a transaction. Move it into its own migration whose first line is -- goribu:no-transaction."
            : "A -- goribu:no-transaction migration must contain exactly one statement, because Postgres runs several statements sent together as one transaction. Split it into one migration per statement.");
        }
        sentences.push(`Fix migrations/${migration.name}.sql and run the command again.`);
        throw new Error(sentences.join(" "), { cause });
      }
      stdout.write(`✓ Applied ${migration.name} to ${target}\n`);
    }
    return plan;
  } finally {
    // Ending the session releases the advisory lock, even if the run failed.
    await sql.end({ timeout: 5 });
  }
}
