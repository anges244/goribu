import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadApplicationConfig } from "../load-application-config.js";
import { MIGRATIONS_DIRNAME } from "./read-migrations.js";

const D1_BINDING = "DB";
const GENERATED_DIRECTORY = ".goribu";
const MIGRATE_CONFIG_FILENAME = "migrate.wrangler.json";
const LOCAL_STATE = join(".wrangler", "state");

/**
 * Resolve everything a migration command or `goribu d1` needs to reach the declared D1 database.
 *
 * A database declaration is required — SQL has nowhere to run without one.
 * The emitted config is intentionally minimal (just the D1 binding, no Worker entry
 * or assets) so `wrangler d1 execute` validates nothing that belongs to a build, and
 * carries the same local id fields as the dev binding so migrate and dev share one
 * local database. Local persistence is pinned to the project's `.wrangler/state`.
 *
 * @param {{ projectRoot: string, loadConfig?: Function }} options
 */
export async function resolveMigrationContext({ projectRoot, loadConfig } = {}) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] migrations require the application project root.",
    );
  }
  const root = resolve(projectRoot);
  const load = loadConfig ?? loadApplicationConfig;
  const appConfig = await load({ projectRoot: root });
  if (appConfig.database?.type === "postgres") {
    throw new Error(
      '[Goribu] The D1 migration and SQL runner cannot use a Postgres database. Run `goribu migrate` or `goribu migrate:status` for Postgres migrations; use `psql "$POSTGRES_URL"` for SQL.',
    );
  }
  if (appConfig.database?.type !== "d1") {
    throw new Error(
      "[Goribu] No D1 database is declared, so there is nothing to run SQL against. " +
        'Add `database: { type: "d1", name: "your-db-name" }` to goribu.config.js first.',
    );
  }

  const configPath = join(root, GENERATED_DIRECTORY, MIGRATE_CONFIG_FILENAME);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        name: appConfig.name,
        compatibility_date: appConfig.compatibilityDate,
        d1_databases: [
          {
            binding: D1_BINDING,
            database_name: appConfig.database.name,
            preview_database_id: appConfig.database.name,
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return Object.freeze({
    appConfig,
    database: D1_BINDING,
    configPath,
    persistTo: join(root, LOCAL_STATE),
    migrationsDir: join(root, MIGRATIONS_DIRNAME),
  });
}
