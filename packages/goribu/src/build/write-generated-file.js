import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Write a generated file only when its bytes would actually change.
 *
 * Goribu regenerates its Worker and Wrangler config from the Vite `config` hook,
 * including on every dev-server restart. The Wrangler config is a file the
 * Cloudflare plugin watches to decide a restart is needed, so an unconditional
 * write makes each restart schedule the next one: the write lands while the
 * previous server's watcher is still open, and whether the resulting restart is
 * suppressed depends on where the filesystem event falls relative to the plugin's
 * in-flight guard. Comparing first keeps an unchanged regeneration invisible to
 * every watcher, which is the honest description of what happened.
 *
 * @param {string} outputFile absolute path to the generated file
 * @param {string} contents the full file contents
 * @returns {boolean} whether the file was written
 */
export function writeGeneratedFile(outputFile, contents) {
  try {
    if (readFileSync(outputFile, "utf8") === contents) return false;
  } catch {
    // Not generated yet, or unreadable: fall through and write it.
  }

  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, contents, "utf8");
  return true;
}
