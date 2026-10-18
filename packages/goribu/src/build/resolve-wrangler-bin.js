import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);

/** Resolve the Wrangler CLI entry from Goribu's pinned dependency. */
export function resolveWranglerBin() {
  const manifestPath = require.resolve("wrangler/package.json");
  const { bin } = JSON.parse(readFileSync(manifestPath, "utf8"));
  return resolve(dirname(manifestPath), bin.wrangler);
}

/**
 * Read the config schema that ships beside that same Wrangler, with its version.
 * The file is published in the package but is not one of its exports.
 */
export function readWranglerSchema() {
  const manifestPath = require.resolve("wrangler/package.json");
  const { version } = JSON.parse(readFileSync(manifestPath, "utf8"));
  const schema = JSON.parse(readFileSync(join(dirname(manifestPath), "config-schema.json"), "utf8"));
  return { version, schema };
}
