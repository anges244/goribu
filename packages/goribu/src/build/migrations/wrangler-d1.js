import { spawn as nodeSpawn } from "node:child_process";
import { resolve } from "node:path";
import { resolveWranglerBin } from "../resolve-wrangler-bin.js";

/**
 * Run one `wrangler d1 execute` against the declared database and return its result.
 *
 * Goribu owns migration policy; Wrangler owns SQL transport, local persistence, and
 * remote authentication. The target is always explicit — Goribu never relies on
 * Wrangler's default of local or remote. `--file` carries a mutation, `--command`
 * carries an inspection; `json` parses Wrangler's per-statement result array.
 *
 * @param {{
 *   projectRoot: string,
 *   configPath: string,
 *   database: string,
 *   target: "local" | "remote",
 *   file?: string,
 *   command?: string,
 *   json?: boolean,
 *   persistTo?: string,
 *   spawn?: Function,
 *   resolveBin?: Function,
 * }} options
 * @returns {Promise<Array<{ results: unknown[], success: boolean, meta?: object }> | undefined>}
 */
export async function executeD1(options) {
  const { projectRoot, configPath, database, target } = options ?? {};
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] executeD1({ projectRoot }) requires the application project root.",
    );
  }
  if (typeof configPath !== "string" || configPath.length === 0) {
    throw new TypeError(
      "[Goribu] executeD1({ configPath }) requires the generated Wrangler config path.",
    );
  }
  if (typeof database !== "string" || database.length === 0) {
    throw new TypeError("[Goribu] executeD1({ database }) requires the D1 binding name.");
  }
  if (target !== "local" && target !== "remote") {
    throw new TypeError('[Goribu] executeD1({ target }) requires "local" or "remote".');
  }
  if ((options.file === undefined) === (options.command === undefined)) {
    throw new TypeError(
      "[Goribu] executeD1() requires exactly one of file or command.",
    );
  }

  const spawn = options.spawn ?? nodeSpawn;
  const resolveBin = options.resolveBin ?? resolveWranglerBin;
  let wranglerBin;
  try {
    wranglerBin = resolveBin();
  } catch (cause) {
    throw new Error(
      "[Goribu] Could not find Wrangler, which `goribu migrate` uses to run D1 SQL. Install dependencies (for example `pnpm install`) and try again.",
      { cause },
    );
  }

  const args = [
    wranglerBin,
    "d1",
    "execute",
    database,
    `--${target}`,
    "--config",
    configPath,
    "-y",
  ];
  if (target === "local" && options.persistTo !== undefined) {
    args.push("--persist-to", options.persistTo);
  }
  if (options.file !== undefined) args.push("--file", options.file);
  if (options.command !== undefined) args.push("--command", options.command);
  if (options.json === true) args.push("--json");

  let child;
  try {
    child = spawn(process.execPath, args, {
      cwd: resolve(projectRoot),
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (cause) {
    throw wranglerError(target, cause);
  }

  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += String(chunk);
  });

  const { code, signal } = await new Promise((resolvePromise, rejectPromise) => {
    child.on("error", (cause) => rejectPromise(wranglerError(target, cause)));
    child.on("close", (exitCode, terminatingSignal) =>
      resolvePromise({ code: exitCode, signal: terminatingSignal }),
    );
  });
  if (signal !== null || code !== 0) throw wranglerError(target);

  if (options.json !== true) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (cause) {
    throw new Error(
      "[Goribu] Wrangler returned unreadable JSON while `goribu migrate` inspected D1. Update Wrangler and try again.",
      { cause },
    );
  }
  return assertResultShape(parsed);
}

/**
 * Require Wrangler's documented `d1 execute --json` shape: a non-empty array of
 * per-statement results, each successful and carrying a rows array.
 *
 * This fails closed. A malformed-but-valid JSON value ({}, [], or a result without
 * `results`) must never be read as "no rows": treating a lost ledger as empty would
 * replay already-applied migrations.
 */
function assertResultShape(parsed) {
  const valid =
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        entry.success === true &&
        Array.isArray(entry.results),
    );
  if (!valid) {
    throw new Error(
      "[Goribu] Wrangler returned an unexpected D1 result shape for `goribu migrate`. " +
        "Expected a non-empty array of successful statement results. Update Wrangler and try " +
        "again; this was a read, so no migration state was changed.",
    );
  }
  return parsed;
}

/** Extract the rows of the final statement in a validated `--json` result. */
export function lastResultRows(result) {
  return result[result.length - 1].results;
}

function wranglerError(target, cause) {
  return new Error(
    `[Goribu] Wrangler could not run the ${target} D1 SQL for \`goribu migrate\`. ` +
      "Read the Wrangler error above, fix authentication or the SQL, then rerun the command. " +
      "No migration was recorded for a statement that did not complete.",
    cause === undefined ? undefined : { cause },
  );
}
