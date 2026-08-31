#!/usr/bin/env node

// The Goribu command-line interface. Someone's first contact with Goribu is
// running a command, so this is the framework's front door. Each verb is wired
// in its own build substep; until then it fails closed with a repair
// instruction rather than pretending to work.

import { readFileSync } from "node:fs";

const COMMANDS = {
  dev: "Start the local development server.",
  build: "Produce the production Worker and client bundles.",
  deploy: "Build and deploy to Cloudflare.",
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
      ([name, summary]) => `  ${name.padEnd(8)}${summary}`,
    ),
    "",
    "Options:",
    "  -v, --version   Print the Goribu version.",
    "  -h, --help      Print this help.",
  ];
  stream.write(`${lines.join("\n")}\n`);
}

function notImplemented(command) {
  console.error(
    `[Goribu] \`goribu ${command}\` is not available yet. It lands later in ` +
      `the Block 1 build; run the framework build to that substep before using it.`,
  );
  process.exitCode = 1;
}

// Run the production build for the app in the current directory. Vite's builder
// drives every environment the Goribu plugin configures, so one call emits both
// the Worker bundle and the client bundle.
async function runBuild() {
  const { createBuilder } = await import("vite");
  const builder = await createBuilder({ root: process.cwd() });
  await builder.buildApp();
}

// Start the local development server for the app in the current directory. Vite
// serves the generated Worker through workerd (via the Cloudflare plugin) with
// HMR; the server keeps the process alive until it is interrupted.
async function runDev() {
  const { createServer } = await import("vite");
  const server = await createServer({ root: process.cwd() });
  await server.listen();
  server.printUrls();
}

function assertNoArguments(command, rest) {
  if (rest.length === 0) return true;
  console.error(
    `[Goribu] \`goribu ${command}\` does not accept arguments, but received ${rest.map((argument) => JSON.stringify(argument)).join(", ")}. Remove them and run \`goribu ${command}\` on its own.`,
  );
  process.exitCode = 1;
  return false;
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

  if (Object.hasOwn(COMMANDS, command)) {
    notImplemented(command, rest);
    return;
  }

  console.error(
    `[Goribu] Unknown command \`${command}\`. Run \`goribu --help\` to see the ` +
      `available commands: ${Object.keys(COMMANDS).join(", ")}.`,
  );
  process.exitCode = 1;
}

main(process.argv.slice(2));
