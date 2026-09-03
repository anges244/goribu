import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);

/** Resolve the Wrangler CLI entry from Goribu's pinned dependency. */
export function resolveWranglerBin() {
  const manifestPath = require.resolve("wrangler/package.json");
  const { bin } = JSON.parse(readFileSync(manifestPath, "utf8"));
  return resolve(dirname(manifestPath), bin.wrangler);
}
