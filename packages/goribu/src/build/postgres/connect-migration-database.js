import { resolve } from "node:path";
import postgres from "postgres";
import { loadApplicationConfig } from "../load-application-config.js";
import { readPostgresEnv } from "./read-postgres-env.js";
import { parsePostgresUrl } from "./parse-postgres-url.js";

/** Open and verify one direct migration session. The caller must end it. */
export async function connectMigrationDatabase({ projectRoot, target, loadConfig }) {
  if (target !== "local" && target !== "remote") {
    throw new TypeError('[Goribu] Postgres migrations require target "local" or "remote".');
  }
  const appConfig = await (loadConfig ?? loadApplicationConfig)({ projectRoot: resolve(projectRoot) });
  if (appConfig.database?.type !== "postgres") {
    throw new Error(
      '[Goribu] This command runs Postgres migrations, but goribu.config.js does not declare `database: { type: "postgres" }`.',
    );
  }
  const env = readPostgresEnv({ projectRoot, target: target === "remote" ? "production" : "local" });
  const entry = env.migrateUrl ?? env.url;
  const { host, port, database } = parsePostgresUrl(entry.value, entry.source);

  // Migrations connect directly, never through Hyperdrive: they hold a session
  // advisory lock, send several statements in one simple-protocol query, and may
  // exceed Hyperdrive's 60 s statement limit. max 1 keeps every query, including
  // sql.begin, on the locked session. max_lifetime null prevents recycling that
  // session mid-run (the default is 30–60 minutes). Drop notices so repeated runs
  // don't print the ledger table's "already exists" notice through console.log.
  const sql = postgres(entry.value, { max: 1, max_lifetime: null, onnotice() {} });
  try {
    await sql`SELECT 1`;
  } catch (cause) {
    await sql.end({ timeout: 5 });
    const detail = cause.message || cause.code || String(cause);
    throw new Error(
      `[Goribu] Could not connect to Postgres at ${host}:${port}/${database} using ${entry.source}: ${detail}. Check that the database is running and reachable from this machine and that the user, password and database name in that value are correct.`,
      { cause },
    );
  }
  return sql;
}
