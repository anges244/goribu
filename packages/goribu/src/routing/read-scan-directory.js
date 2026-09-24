import { readdirSync, statSync } from "node:fs";
import { relative, sep } from "node:path";

/**
 * Validate and read the root shared by Goribu's route-tree scanners.
 *
 * A missing root is the one non-error filesystem outcome and returns null. Each
 * scanner still owns what it selects from the deterministic Dirent snapshot.
 *
 * @param {string} routesDir
 * @param {{ caller: string, subject: string, directoryLabel?: string }} context
 * @returns {import("node:fs").Dirent[]|null}
 */
export function readScanRoot(routesDir, context) {
  const directoryLabel = context.directoryLabel ?? "src/routes";
  if (typeof routesDir !== "string" || routesDir.length === 0) {
    throw new TypeError(
      `[Goribu] ${context.caller}(routesDir) requires the path to your ${directoryLabel} directory.`,
    );
  }

  let routesDirStat;
  try {
    routesDirStat = statSync(routesDir);
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    throw scanError(routesDir, context.subject, cause);
  }

  if (!routesDirStat.isDirectory()) {
    throw new Error(
      `[Goribu] Could not scan ${context.subject} because "${routesDir}" is not a directory. ` +
        `Use a directory at ${directoryLabel} in your application.`,
    );
  }

  return readScanDirectory(routesDir, {
    routesDir,
    subject: context.subject,
  });
}

/**
 * Read one real directory inside a validated route tree with shared error context.
 *
 * @param {string} directory
 * @param {{ routesDir: string, subject: string }} context
 * @returns {import("node:fs").Dirent[]}
 */
export function readScanDirectory(directory, context) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (cause) {
    throw scanError(context.routesDir, context.subject, cause);
  }

  return entries.sort((a, b) => compareStrings(a.name, b.name));
}

/**
 * Give scanner-selected native paths one canonical stable result shape.
 *
 * @param {string} routesDir
 * @param {string[]} filePaths
 * @returns {Array<{ filePath: string, relativePath: string }>}
 */
export function createScanFileRecords(routesDir, filePaths) {
  return filePaths
    .map((filePath) => ({
      filePath,
      relativePath: relative(routesDir, filePath).split(sep).join("/"),
    }))
    .sort((a, b) => compareStrings(a.relativePath, b.relativePath));
}

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function scanError(routesDir, subject, cause) {
  return new Error(
    `[Goribu] Could not scan ${subject} in "${routesDir}". ` +
      `Make sure the directory is readable and try again. ${cause.message}`,
    { cause },
  );
}
