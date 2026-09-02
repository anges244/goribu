import { basename, extname, join } from "node:path";
import {
  createScanFileRecords,
  readScanDirectory,
  readScanRoot,
} from "./read-scan-directory.js";
import { isRouteFile } from "./scan-routes.js";

/**
 * Discover folder-scoped _middleware modules in an application's route tree.
 *
 * Results carry native filesystem identities for future static imports and
 * slash-normalized relative identities for deterministic build-time processing.
 * This scanner does not read exports, import modules, select a matched route's
 * ancestor scopes, order a middleware chain, or flatten array exports.
 *
 * @param {string} routesDir Path to the application's src/routes directory.
 * @returns {Array<{ filePath: string, relativePath: string }>}
 */
export function scanMiddleware(routesDir) {
  const scanContext = { routesDir, subject: "middleware files" };
  const entries = readScanRoot(routesDir, {
    caller: "scanMiddleware",
    subject: scanContext.subject,
  });
  if (entries === null) return [];

  const filePaths = [];
  walk(routesDir, entries, filePaths, scanContext);

  return createScanFileRecords(routesDir, filePaths);
}

function walk(currentDir, entries, filePaths, scanContext) {
  let middlewarePath = null;

  for (const entry of entries) {
    const filePath = join(currentDir, entry.name);

    // Underscore-prefixed directories cannot contain URL routes, so middleware
    // below them has no route scope and is excluded with the same boundary used
    // by normal route discovery.
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_")) continue;

      const childEntries = readScanDirectory(filePath, scanContext);
      walk(filePath, childEntries, filePaths, scanContext);
      continue;
    }

    // Symlinks and unsupported/lookalike files are not executable middleware.
    if (!entry.isFile() || !isMiddlewareFile(entry.name)) continue;

    if (middlewarePath !== null) {
      throw new Error(
        `[Goribu] Multiple _middleware modules were found in "${currentDir}": ` +
          `"${middlewarePath}" and "${filePath}". Keep exactly one _middleware.js, ` +
          "_middleware.jsx, _middleware.ts, or _middleware.tsx file in each route directory.",
      );
    }

    middlewarePath = filePath;
  }

  // Collection order has no chain semantics: the shared record builder sorts by
  // source identity, while matched-route ancestor ordering remains deferred.
  if (middlewarePath !== null) filePaths.push(middlewarePath);
}

function isMiddlewareFile(filename) {
  if (!isRouteFile(filename)) return false;
  return basename(filename, extname(filename)) === "_middleware";
}
