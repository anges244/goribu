import { createInterface } from "node:readline/promises";
import { resolveMigrationContext } from "./migrations/migration-context.js";
import { executeD1 } from "./migrations/wrangler-d1.js";

/**
 * Run one piece of SQL against the declared D1 database and let Wrangler print
 * the results. Local is the database `goribu dev` and `goribu migrate` use.
 *
 * Production runs a single SELECT directly, because it cannot change data. Any
 * other SQL needs the database name typed at a terminal; without one it is
 * refused, so scripts and agents change production data through migrations.
 *
 * @param {{ projectRoot: string, sql: string, target?: "local" | "remote", loadConfig?: Function, execute?: Function, canPrompt?: boolean, ask?: (question: string) => Promise<string | null> }} options
 */
export async function runD1(options) {
  const { projectRoot, sql } = options;
  const target = options.target ?? "local";
  const confirm = target === "remote" && !isSingleSelect(sql);
  if (confirm && !(options.canPrompt ?? (process.stdin.isTTY && process.stdout.isTTY))) {
    throw new Error(
      "[Goribu] `goribu d1 --remote` runs only a single SELECT without confirmation, and this SQL may change production data. " +
        "Run it from an interactive terminal to confirm, or make the change a migration with `goribu migrate:new <name>`. Nothing was run.",
    );
  }

  const context = await resolveMigrationContext({ projectRoot, loadConfig: options.loadConfig });
  if (confirm) {
    const name = context.appConfig.database.name;
    const ask = options.ask ?? askInTerminal;
    const answer = await ask(
      `This SQL may change production data in D1 database "${name}":\n  ${sql.trim()}\n` +
        "Production data changes are safer as migrations, which are recorded and reviewable.\n" +
        `Type "${name}" to run it: `,
    );
    if (answer?.trim() !== name) {
      throw new Error(`[Goribu] The confirmation did not match "${name}", so nothing was run. Rerun \`goribu d1 --remote\` and type the database name to proceed.`);
    }
  }

  const execute = options.execute ?? executeD1;
  await execute({
    projectRoot,
    configPath: context.configPath,
    database: context.database,
    persistTo: context.persistTo,
    target,
    command: sql,
    adHoc: true,
    errorLabel: "goribu d1",
  });
}

// A SELECT cannot change data. Anything less certain, including a second statement
// or a semicolon inside a string, counts as a possible change.
function isSingleSelect(sql) {
  const statement = sql.trim().replace(/;\s*$/, "");
  return /^select\b/i.test(statement) && !statement.includes(";");
}

// Ctrl-C or end of input declines rather than leaving the question open.
async function askInTerminal(question) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const controller = new AbortController();
  terminal.on("SIGINT", () => controller.abort());
  terminal.on("close", () => controller.abort());
  try {
    return await terminal.question(question, { signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      process.stdout.write("\n");
      return null;
    }
    throw error;
  } finally {
    terminal.close();
  }
}
