#!/usr/bin/env node

if (Number(process.versions.node.split(".")[0]) < 22) {
  console.error(`[Goribu] create-goribu requires Node.js 22 or newer; you are running ${process.version}. Run nvm use 22 (or upgrade Node), then retry.`);
  process.exit(1);
}

try {
  const { run } = await import("../src/index.js");
  await run(process.argv.slice(2));
} catch (error) {
  console.error(error.message?.startsWith("[Goribu]") ? error.message : `[Goribu] Could not create the app: ${error.message}. Check filesystem permissions and choose a new directory before retrying.`);
  process.exitCode = 1;
}
