#!/usr/bin/env node

// The Goribu command-line interface. Someone's first contact with Goribu is
// running a command, so this is the framework's front door. Each verb is wired
// in its own build substep; until then it fails closed with a repair
// instruction rather than pretending to work.

import { readFileSync } from "node:fs";
import { runCheck } from "../src/build/run-check.js";
import { endFailedSession, installDevLifecycle } from "../src/build/development-lifecycle.js";
import { runDeploy as deployApplication } from "../src/build/run-deploy.js";
import { prerenderStaticRoutes } from "../src/build/prerender-static-routes.js";
import { runMigrate } from "../src/build/migrations/run-migrate.js";
import { runMigrateDown } from "../src/build/migrations/run-migrate-down.js";
import { runMigrateNew } from "../src/build/migrations/run-migrate-new.js";
import { runMigrateSeed } from "../src/build/migrations/run-migrate-seed.js";
import { runMigrateStatus } from "../src/build/migrations/run-migrate-status.js";

const COMMANDS = {
  dev: "Start the local development server.",
  build: "Produce the production Worker and client bundles.",
  check: "Preview production resources without changing them.",
  deploy: "Build, apply production migrations, and deploy to Cloudflare.",
  migrate: "Apply pending D1 migrations (default local; --remote for production).",
  "migrate:down": "Roll back the last applied migration (default local; --remote supported).",
  "migrate:new": "Scaffold the next migration file: goribu migrate:new <name>.",
  "migrate:seed": "Run migrations/seed.sql against local D1 only.",
  "migrate:status": "Show applied and pending migrations without changing anything.",
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
      ([name, summary]) => `  ${name.padEnd(16)}${summary}`,
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
// without ever invoking the Worker at request time.
async function runBuild() {
  const { createBuilder } = await import("vite");
  const builder = await createBuilder({ root: process.cwd() });
  await builder.buildApp();
  await prerenderStaticRoutes({ projectRoot: process.cwd() });
}

// Start the local development server for the app in the current directory. Vite
// serves the generated Worker through workerd (via the Cloudflare plugin) with
// HMR; the server keeps the process alive until it is interrupted.
async function runDev() {
  const { createServer } = await import("vite");
  let server;
  try {
    server = await createServer({ root: process.cwd() });
  } catch (error) {
    // Vite drops a server whose setup threw without closing it, and it may
    // already hold a watcher and a Worker runtime. Report before ending the
    // session, because ending it may take the process with it.
    console.error(error);
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
    throw error;
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

function assertNoArguments(command, rest) {
  if (rest.length === 0) return true;
  console.error(
    `[Goribu] \`goribu ${command}\` does not accept arguments, but received ${rest.map((argument) => JSON.stringify(argument)).join(", ")}. Remove them and run \`goribu ${command}\` on its own.`,
  );
  process.exitCode = 1;
  return false;
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
    if (!assertNoArguments("dev", rest)) return;
    runDev().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
    return;
  }

  if (command === "build") {
    if (!assertNoArguments("build", rest)) return;
    runBuild().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
    return;
  }

  if (command === "check") {
    if (!assertNoArguments("check", rest)) return;
    runCheck({ projectRoot: process.cwd() }).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
    return;
  }

  if (command === "deploy") {
    if (!assertNoArguments("deploy", rest)) return;
    runDeploy().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
    return;
  }

  if (command === "migrate" || command === "migrate:down" || command === "migrate:status") {
    const target = resolveTarget(command, rest);
    if (target === null) return;
    const run =
      command === "migrate"
        ? runMigrate
        : command === "migrate:down"
          ? runMigrateDown
          : runMigrateStatus;
    run({ projectRoot: process.cwd(), target }).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
    return;
  }

  if (command === "migrate:seed") {
    const target = resolveSeedTarget(rest);
    if (target === null) return;
    runMigrateSeed({ projectRoot: process.cwd(), target }).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
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
      console.error(error);
      process.exitCode = 1;
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
