import { statSync } from "node:fs";
import { join } from "node:path";
import { resolveMigrationContext } from "./migration-context.js";
import { MIGRATIONS_DIRNAME, SEED_FILENAME } from "./read-migrations.js";
import { executeD1 } from "./wrangler-d1.js";

/**
 * Run the application's repeatable seed SQL against local D1 only.
 *
 * Seeds are development/test data rather than migration history. They never touch
 * the tracking table, and the production guard runs before config loading or SQL.
 *
 * @param {{ projectRoot: string, target?: "local" | "remote", stdout?: { write(text: string): void }, loadConfig?: Function, execute?: Function }} options
 */
export async function runMigrateSeed(options) {
  const target = options?.target ?? "local";
  if (target === "remote") {
    throw new Error(
      "[Goribu] `goribu migrate:seed` never runs against production. " +
        "Remove --remote and run it against local D1; use a migration for production data changes.",
    );
  }
  if (target !== "local") {
    throw new TypeError(
      '[Goribu] runMigrateSeed({ target }) requires "local". Production seeds are forbidden.',
    );
  }

  const stdout = options?.stdout ?? process.stdout;
  const execute = options?.execute ?? executeD1;
  const context = await resolveMigrationContext({
    projectRoot: options?.projectRoot,
    loadConfig: options?.loadConfig,
  });
  const seedFile = join(context.migrationsDir, SEED_FILENAME);

  let isFile = false;
  try {
    isFile = statSync(seedFile).isFile();
  } catch (cause) {
    if (cause?.code !== "ENOENT") throw cause;
  }
  if (!isFile) {
    throw new Error(
      `[Goribu] No seed file exists at ${MIGRATIONS_DIRNAME}/${SEED_FILENAME}. ` +
        `Create ${MIGRATIONS_DIRNAME}/${SEED_FILENAME} with repeatable local development data, then rerun \`goribu migrate:seed\`.`,
    );
  }

  await execute({
    projectRoot: options.projectRoot,
    configPath: context.configPath,
    database: context.database,
    persistTo: context.persistTo,
    target: "local",
    file: seedFile,
  });
  stdout.write(`✓ Ran ${MIGRATIONS_DIRNAME}/${SEED_FILENAME} on local\n`);
}
