import { join } from "node:path";
import {
  createScanFileRecords,
  readScanDirectory,
  readScanRoot,
} from "./read-scan-directory.js";

// Discovery and manifest generation share this executable route-file boundary
// so adding an extension cannot make those two steps interpret paths differently.
export const ROUTE_EXTENSION = /\.(?:js|jsx|ts|tsx)$/;

/**
 * Walk a routes directory and return the regular files that can become routes.
 *
 * Each result contains an OS-native filePath for filesystem access and a
 * slash-normalized relativePath for stable manifests. A missing directory is a
 * valid empty route set, while an unreadable directory fails closed with repair
 * guidance instead of silently producing an incomplete application.
 *
 * @param {string} routesDir Path to the application's src/routes directory.
 * @returns {Array<{ filePath: string, relativePath: string }>}
 */
export function scanRoutes(routesDir) {
  const scanContext = { routesDir, subject: "route files" };
  const entries = readScanRoot(routesDir, {
    caller: "scanRoutes",
    subject: scanContext.subject,
  });
  if (entries === null) return [];

  const filePaths = [];
  walk(routesDir, entries, filePaths, scanContext);

  return createScanFileRecords(routesDir, filePaths);
}

/**
 * Recursively collect route-file paths into one caller-owned array.
 *
 * Keeping one accumulator avoids allocating and merging an array for every
 * folder. withFileTypes supplies each entry's kind during the directory read,
 * avoiding a separate stat call for every child.
 */
function walk(currentDir, entries, filePaths, scanContext) {
  for (const entry of entries) {
    // Every underscore-prefixed path segment is reserved. Skipping a directory
    // here intentionally excludes its entire subtree from normal URL routes;
    // dedicated scanners can still discover _middleware, _404, and _500 later.
    if (entry.name.startsWith("_")) continue;

    const filePath = join(currentDir, entry.name);

    // Descend only into real directories. Symlinked directories are not followed,
    // preventing cycles and keeping discovery inside the concrete route tree.
    if (entry.isDirectory()) {
      const childEntries = readScanDirectory(filePath, scanContext);
      walk(filePath, childEntries, filePaths, scanContext);
      continue;
    }

    // Accept only real files, so symlinked files are skipped just like symlinked
    // directories. Unsupported filenames are filtered by isRouteFile below.
    if (!entry.isFile() || !isRouteFile(entry.name)) continue;

    // Keep discovery concerned only with native filesystem paths. The shared
    // record builder adds stable relative identities after traversal finishes.
    filePaths.push(filePath);
  }
}

/**
 * Decide whether a regular file has an executable route-module filename.
 */
export function isRouteFile(filename) {
  // Declaration files end in .ts but contain types rather than executable route
  // code, so they must be rejected before the general extension check.
  if (filename.endsWith(".d.ts")) return false;
  return ROUTE_EXTENSION.test(filename);
}
