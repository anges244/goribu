#!/usr/bin/env node

// The Goribu command-line interface. Someone's first contact with Goribu is
// running a command, so this is the framework's front door. Each verb is wired
// in its own build substep; until then it fails closed with a repair
// instruction rather than pretending to work.

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { runCheck } from "../src/build/run-check.js";
import { runCloudflareLogin } from "../src/build/run-cloudflare-login.js";
import { runD1 } from "../src/build/run-d1.js";
import { runTail } from "../src/build/run-tail.js";
import { runWrangler } from "../src/build/run-wrangler.js";
import { endFailedSession, installDevLifecycle } from "../src/build/development-lifecycle.js";
import { runDeploy as deployApplication } from "../src/build/run-deploy.js";
import { prerenderStaticRoutes } from "../src/build/prerender-static-routes.js";
import { finalizeWorkerRouting } from "../src/build/finalize-worker-routing.js";
import { loadApplicationConfig } from "../src/build/load-application-config.js";
import { listPrerenderWithheld } from "../src/build/wrangler-passthrough.js";
import { runPostgresMigrate } from "../src/build/postgres/run-postgres-migrate.js";
import { runPostgresMigrateStatus } from "../src/build/postgres/run-postgres-migrate-status.js";
import { runMigrate } from "../src/build/migrations/run-migrate.js";
import { runMigrateNew } from "../src/build/migrations/run-migrate-new.js";
import { runMigrateSeed } from "../src/build/migrations/run-migrate-seed.js";
import { runMigrateStatus } from "../src/build/migrations/run-migrate-status.js";

const COMMANDS = {
  dev: "Start the local development server: goribu dev [--port <number>] [--host].",
  build: "Produce the production Worker and client bundles.",
  check: "Preview production resources without changing them.",
  deploy: "Build, apply production migrations, and deploy to Cloudflare.",
  tail: "Stream live logs from the deployed Worker.",
  "cloudflare-login": "Log in to Cloudflare through Wrangler.",
  wrangler: "Run Goribu's Wrangler with the deploy account: goribu wrangler <args>.",
  migrate: "Apply pending D1 or Postgres migrations (default local; --remote for production).",
  "migrate:new": "Scaffold the next migration file: goribu migrate:new <name>.",
  "migrate:seed": "Run migrations/seed.sql against local D1 only.",
  "migrate:status": "Show applied and pending migrations without changing anything.",
  d1: 'Run SQL against D1 (default local; --remote for production): goribu d1 "<sql>".',
};

function readVersion() {
  const packageUrl = new URL("../package.json", import.meta.url);
  const { version } = JSON.parse(readFileSync(packageUrl, "utf8"));
  return version;
}

function printUsage(stream) {
  const lines = [
    "Usage: goribu <command> [options]",
    "",
    "Commands:",
    ...Object.entries(COMMANDS).map(
      ([name, summary]) => `  ${name.padEnd(18)}${summary}`,
    ),
    "",
    "Options:",
    "  -v, --version   Print the Goribu version.",
    "  -h, --help      Print this help.",
  ];
  stream.write(`${lines.join("\n")}\n`);
}

// Run the production build for the app in the current directory. Vite's builder
// drives every environment the Goribu plugin configures, so one call emits both
// the Worker bundle and the client bundle. Once those exist, Goribu produces the
// build-time static output: routes whose first response needs no Worker are
// rendered by running the emitted Worker in workerd and asking it for each route,
// then written into the client asset directory, so Static Assets serves them
// without ever invoking the Worker at request time. Routing is planned last,
// from the routes that actually prerendered and the final asset inventory.
// That build-time Worker runs without the wrangler block's fields other than
// vars, so building needs no Cloudflare access; the deploy config keeps them.
async function runBuild() {
  const { createBuilder } = await import("vite");
  const builder = await createBuilder({ root: process.cwd() });
  await builder.buildApp();
  const { wrangler } = await loadApplicationConfig({ projectRoot: process.cwd() });
  const withheld = listPrerenderWithheld(wrangler);
  const { outputs, prerendered } = await prerenderStaticRoutes({ projectRoot: process.cwd(), withheld });
  await finalizeWorkerRouting({ projectRoot: process.cwd(), prerendered, outputs, withheld: withheld.fields });
  console.log(
    `[Goribu] Build complete.\n` +
    `  HTML and browser assets: ${relative(process.cwd(), outputs.clientDir)}\n` +
    `  Worker: ${relative(process.cwd(), outputs.workerFile)}\n` +
    `  Deployment configuration: ${relative(process.cwd(), outputs.configPath)}`,
  );
}

// Start the local development server for the app in the current directory. Vite
// serves the generated Worker through workerd (via the Cloudflare plugin) with
// HMR; the server keeps the process alive until it is interrupted. Command-line
// server settings are Vite inline config, which overrides vite.config.js and is
// reused by every restart of the session.
async function runDev(serverOptions) {
  const { createServer } = await import("vite");
  let server;
  try {
    server = await createServer({ root: process.cwd(), server: serverOptions });
  } catch (error) {
    // Vite drops a server whose setup threw without closing it, and it may
    // already hold a watcher and a Worker runtime. Report before ending the
    // session, because ending it may take the process with it.
    fail(error);
    await endFailedSession();
    return;
  }
  installDevLifecycle(server);
  try {
    await server.listen();
  } catch (error) {
    // A server that failed to listen may still hold a workerd child, because the
    // Cloudflare plugin starts one while the server is being configured.
    try {
      await server.close();
    } catch {
      // Report why the server never started, not why the wreckage resisted.
    }
    if (serverOptions.port === undefined) throw error;
    throw new Error(
      `[Goribu] \`goribu dev --port ${serverOptions.port}\` could not listen on port ${serverOptions.port}. ` +
        "If another program is using it, stop that program or choose another port.",
      { cause: error },
    );
  }
  server.printUrls();
}

// Authenticate, build, provision resources, apply production migrations, then deploy
// through Wrangler. The build writes a deploy-redirect at .wrangler/deploy/config.json
// that points Wrangler at the generated Worker bundle and static assets, so the final
// upload uses exactly what the build produced. Wrangler owns Cloudflare authentication.
async function runDeploy() {
  const exitCode = await deployApplication({
    projectRoot: process.cwd(),
    build: runBuild,
  });
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

// A `[Goribu]` error is an expected failure whose message already says how to
// repair it, so it prints as that message plus the reasons it wraps, without
// stacks of framework or Node internals. An unexpected error prints in full,
// because its stack is how it gets fixed.
function fail(error) {
  process.exitCode = 1;
  if (!isGoribuError(error)) {
    console.error(error);
    return;
  }
  const lines = [error.message];
  for (let cause = error.cause; cause !== undefined && cause !== null; cause = cause.cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (lines.some((line) => line.includes(message))) continue;
    lines.push(`Caused by: ${isGoribuError(cause) ? message : String(cause)}`);
  }
  console.error(lines.join("\n"));
}

function isGoribuError(error) {
  return error instanceof Error && error.message.startsWith("[Goribu]");
}

function assertNoArguments(command, rest) {
  if (rest.length === 0) return true;
  console.error(
    `[Goribu] \`goribu ${command}\` does not accept arguments, but received ${rest.map((argument) => JSON.stringify(argument)).join(", ")}. Remove them and run \`goribu ${command}\` on its own.`,
  );
  process.exitCode = 1;
  return false;
}

// Resolve per-run dev server settings. A port named on the command line is the
// one this run listens on, so an occupied port fails instead of moving the URL.
// `--host` listens on every network interface; a specific address and allowed
// hostnames stay in vite.config.js.
function resolveDevServerOptions(rest) {
  const options = {};
  const reject = (message) => {
    console.error(`[Goribu] ${message}`);
    process.exitCode = 1;
    return null;
  };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--host") {
      if (options.host !== undefined) return reject("`goribu dev` received --host more than once.");
      const next = rest[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        return reject(
          `\`goribu dev --host\` takes no address, but received ${JSON.stringify(next)}. ` +
            "It listens on every network interface. To listen on one address, set `server.host` in vite.config.js.",
        );
      }
      options.host = true;
    } else if (argument === "--port" || argument.startsWith("--port=")) {
      if (options.port !== undefined) return reject("`goribu dev` received --port more than once.");
      const value = argument === "--port" ? rest[(index += 1)] : argument.slice("--port=".length);
      const port = /^\d+$/.test(value ?? "") ? Number(value) : NaN;
      if (!(port >= 1 && port <= 65535)) {
        return reject(
          `\`goribu dev --port\` needs a port number from 1 to 65535, but received ${value === undefined ? "nothing" : JSON.stringify(value)}. ` +
            "Example: `goribu dev --port 5199`.",
        );
      }
      options.port = port;
      options.strictPort = true;
    } else {
      return reject(
        `\`goribu dev\` accepts only --port <number> and --host, but received ${JSON.stringify(argument)}.`,
      );
    }
  }
  return options;
}

// Resolve the migration target. It is always explicit in intent: no flag means
// the local development database, --remote means the deployed production database.
function resolveTarget(command, rest) {
  let target;
  for (const argument of rest) {
    let next;
    if (argument === "--local") next = "local";
    else if (argument === "--remote") next = "remote";
    else {
      console.error(
        `[Goribu] \`goribu ${command}\` accepts only --local (default) or --remote, but received ${JSON.stringify(argument)}.`,
      );
      process.exitCode = 1;
      return null;
    }
    if (target !== undefined && target !== next) {
      console.error(
        `[Goribu] \`goribu ${command}\` cannot target both --local and --remote. Choose one.`,
      );
      process.exitCode = 1;
      return null;
    }
    target = next;
  }
  return target ?? "local";
}

// Seed data is deliberately local-only. Reject production before the runner loads
// application config so the safety rail is independent of project validity.
function resolveSeedTarget(rest) {
  for (const argument of rest) {
    if (argument === "--remote") {
      console.error(
        "[Goribu] `goribu migrate:seed` never runs against production. Remove --remote and run it against local D1; use a migration for production data changes.",
      );
      process.exitCode = 1;
      return null;
    }
    if (argument !== "--local") {
      console.error(
        `[Goribu] \`goribu migrate:seed\` accepts only --local (the default), but received ${JSON.stringify(argument)}.`,
      );
      process.exitCode = 1;
      return null;
    }
  }
  return "local";
}

// `goribu d1` takes one quoted SQL argument plus the migration target flags. A
// word that looks like an option is rejected as one, but SQL that merely starts
// with a `--` comment is still SQL.
function resolveD1Arguments(rest) {
  const flags = rest.filter((argument) => /^--?[a-z][\w-]*$/i.test(argument));
  const sql = rest.filter((argument) => !flags.includes(argument));
  const target = resolveTarget("d1", flags);
  if (target === null) return null;
  if (sql.length !== 1 || sql[0].trim().length === 0) {
    console.error(
      `[Goribu] \`goribu d1\` takes the SQL as one quoted argument, but received ${sql.length === 0 ? "none" : sql.length === 1 ? "empty SQL" : `${sql.length} arguments`}. ` +
        'Example: `goribu d1 "SELECT * FROM posts LIMIT 5"`.',
    );
    process.exitCode = 1;
    return null;
  }
  return { target, sql: sql[0] };
}

// Arguments are validated before this boundary loads the config once; runners
// reuse that snapshot rather than importing the application config again.
async function runDatabaseCommand(command, options) {
  const projectRoot = process.cwd();
  const appConfig = await loadApplicationConfig({ projectRoot });
  const shared = { projectRoot, ...options, loadConfig: async () => appConfig };
  if (appConfig.database?.type === "postgres") {
    if (command === "migrate:seed") {
      throw new Error('[Goribu] `goribu migrate:seed` is D1-only. For Postgres, run `psql "$POSTGRES_URL" -f migrations/seed.sql`.');
    }
    if (command === "d1") {
      throw new Error('[Goribu] `goribu d1` is D1-only. For Postgres, run `psql "$POSTGRES_URL"`.');
    }
    const run = command === "migrate" ? runPostgresMigrate : runPostgresMigrateStatus;
    return run(shared);
  }
  const runners = {
    migrate: runMigrate,
    "migrate:status": runMigrateStatus,
    "migrate:seed": runMigrateSeed,
    d1: runD1,
  };
  return runners[command](shared);
}

function main(argv) {
  const [command, ...rest] = argv;

  if (command === undefined || command === "-h" || command === "--help") {
    printUsage(process.stdout);
    return;
  }

  if (command === "-v" || command === "--version") {
    process.stdout.write(`${readVersion()}\n`);
    return;
  }

  if (command === "dev") {
    const serverOptions = resolveDevServerOptions(rest);
    if (serverOptions === null) return;
    runDev(serverOptions).catch(fail);
    return;
  }

  if (command === "build") {
    if (!assertNoArguments("build", rest)) return;
    runBuild().catch(fail);
    return;
  }

  if (command === "check") {
    if (!assertNoArguments("check", rest)) return;
    runCheck({ projectRoot: process.cwd() }).then((plan) => {
      if (plan.r2?.errors.length) process.exitCode = 1;
    }).catch(fail);
    return;
  }

  if (command === "deploy") {
    if (!assertNoArguments("deploy", rest)) return;
    runDeploy().catch(fail);
    return;
  }

  if (command === "tail") {
    if (!assertNoArguments("tail", rest)) return;
    runTail({ projectRoot: process.cwd() }).then((code) => {
      process.exitCode = code;
    }).catch(fail);
    return;
  }

  if (command === "cloudflare-login") {
    if (!assertNoArguments("cloudflare-login", rest)) return;
    runCloudflareLogin({ projectRoot: process.cwd() }).then((code) => {
      process.exitCode = code;
    }).catch(fail);
    return;
  }

  if (command === "wrangler") {
    runWrangler({ projectRoot: process.cwd(), args: rest }).then((code) => {
      process.exitCode = code;
    }).catch(fail);
    return;
  }

  if (command === "migrate:down") {
    fail(new Error("[Goribu] `goribu migrate:down` was removed in 0.9.4. Write a new forward migration to undo a change."));
    return;
  }

  if (command === "migrate" || command === "migrate:status") {
    const target = resolveTarget(command, rest);
    if (target === null) return;
    runDatabaseCommand(command, { target }).catch(fail);
    return;
  }

  if (command === "migrate:seed") {
    const target = resolveSeedTarget(rest);
    if (target === null) return;
    runDatabaseCommand(command, { target }).catch(fail);
    return;
  }

  if (command === "d1") {
    const d1 = resolveD1Arguments(rest);
    if (d1 === null) return;
    runDatabaseCommand(command, d1).catch(fail);
    return;
  }

  if (command === "migrate:new") {
    const name = rest.filter((argument) => !argument.startsWith("--")).join(" ");
    if (rest.some((argument) => argument.startsWith("--")) || name.length === 0) {
      console.error(
        "[Goribu] `goribu migrate:new <name>` takes a descriptive name, not options. Example: `goribu migrate:new create feedback`.",
      );
      process.exitCode = 1;
      return;
    }
    try {
      runMigrateNew({ projectRoot: process.cwd(), name });
    } catch (error) {
      fail(error);
    }
    return;
  }

  console.error(
    `[Goribu] Unknown command \`${command}\`. Run \`goribu --help\` to see the ` +
      `available commands: ${Object.keys(COMMANDS).join(", ")}.`,
  );
  process.exitCode = 1;
}

main(process.argv.slice(2));
