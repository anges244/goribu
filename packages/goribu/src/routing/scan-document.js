import { basename, extname, join } from "node:path";
import { readScanRoot } from "./read-scan-directory.js";
import { isRouteFile } from "./scan-routes.js";

const DOCUMENT_BASENAME = "_document";

/**
 * Discover the optional application-wide `_document` module.
 *
 * Only the top level of src/setup participates. This scanner returns a filesystem
 * identity for later build integration; it does not inspect exports or choose a
 * fallback. When no `_document` exists the framework's default shell is used.
 *
 * @param {string} projectRoot Path to the application directory.
 * @returns {string|null} The discovered _document file path, or null.
 */
export function scanDocument(projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError("[Goribu] scanDocument(projectRoot) requires the application directory containing src/setup.");
  }

  const routesDir = join(projectRoot, "src/routes");
  const legacyEntries = readScanRoot(routesDir, { caller: "scanDocument", subject: "document" });
  const legacy = legacyEntries?.find((entry) =>
    entry.isFile() && isRouteFile(entry.name) &&
    basename(entry.name, extname(entry.name)) === DOCUMENT_BASENAME,
  );
  if (legacy) {
    throw new Error(
      `[Goribu] src/routes/${legacy.name} has moved. Move it to src/setup/${legacy.name}, ` +
        "update its relative imports, and set <ClientEntry src=\"/src/setup/client-entry.js\" />. Keep only the setup copy.",
    );
  }

  const setupDir = join(projectRoot, "src/setup");
  const entries = readScanRoot(setupDir, {
    caller: "scanDocument",
    subject: "document",
    directoryLabel: "src/setup",
  });
  if (entries === null) return null;

  let found = null;

  for (const entry of entries) {
    if (!entry.isFile() || !isRouteFile(entry.name)) continue;
    if (basename(entry.name, extname(entry.name)) !== DOCUMENT_BASENAME) continue;

    const filePath = join(setupDir, entry.name);
    if (found !== null) {
      throw new Error(
        `[Goribu] Multiple _document modules were found: "${found}" and "${filePath}". ` +
          "Keep exactly one _document.js, _document.jsx, _document.ts, or _document.tsx file in src/setup.",
      );
    }

    found = filePath;
  }

  return found;
}
