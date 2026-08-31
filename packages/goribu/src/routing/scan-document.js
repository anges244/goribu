import { basename, extname, join } from "node:path";
import { readScanRoot } from "./read-scan-directory.js";
import { isRouteFile } from "./scan-routes.js";

const DOCUMENT_BASENAME = "_document";

/**
 * Discover the optional application-wide `_document` module.
 *
 * Only the top level of the routes directory participates, matching `_404` and
 * `_500` discovery. This scanner returns a filesystem identity for later build
 * integration; it does not import the module, inspect its exports, or choose a
 * fallback. When no `_document` exists the framework's default shell is used.
 *
 * @param {string} routesDir Path to the application's src/routes directory.
 * @returns {string|null} The discovered _document file path, or null.
 */
export function scanDocument(routesDir) {
  const entries = readScanRoot(routesDir, {
    caller: "scanDocument",
    subject: "document",
  });
  if (entries === null) return null;

  let found = null;

  for (const entry of entries) {
    if (!entry.isFile() || !isRouteFile(entry.name)) continue;
    if (basename(entry.name, extname(entry.name)) !== DOCUMENT_BASENAME) continue;

    const filePath = join(routesDir, entry.name);
    if (found !== null) {
      throw new Error(
        `[Goribu] Multiple _document modules were found: "${found}" and "${filePath}". ` +
          "Keep exactly one _document.js, _document.jsx, _document.ts, or _document.tsx file at the top level of src/routes.",
      );
    }

    found = filePath;
  }

  return found;
}
