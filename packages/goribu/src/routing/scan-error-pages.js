import { basename, extname, join } from "node:path";
import { readScanRoot } from "./read-scan-directory.js";
import { isRouteFile } from "./scan-routes.js";

const ERROR_PAGE_KINDS = new Map([
  ["_404", "notFound"],
  ["_500", "serverError"],
]);

/**
 * Discover the optional application-wide _404 and _500 route modules.
 *
 * Only the top level of the routes directory participates. This scanner returns
 * filesystem identities for later build integration; it does not import modules,
 * inspect exports, resolve metadata, or choose fallback pages.
 *
 * @param {string} routesDir Path to the application's src/routes directory.
 * @returns {{ notFound: string|null, serverError: string|null }}
 */
export function scanErrorPages(routesDir) {
  const entries = readScanRoot(routesDir, {
    caller: "scanErrorPages",
    subject: "error pages",
  });
  if (entries === null) return emptyResult();

  const result = emptyResult();

  for (const entry of entries) {
    if (!entry.isFile() || !isRouteFile(entry.name)) continue;

    const extension = extname(entry.name);
    const kind = ERROR_PAGE_KINDS.get(basename(entry.name, extension));
    if (kind === undefined) continue;

    const filePath = join(routesDir, entry.name);
    if (result[kind] !== null) {
      const pageName = kind === "notFound" ? "_404" : "_500";
      throw new Error(
        `[Goribu] Multiple ${pageName} page modules were found: "${result[kind]}" and "${filePath}". ` +
          `Keep exactly one ${pageName}.js, ${pageName}.jsx, ${pageName}.ts, or ${pageName}.tsx file at the top level of src/routes.`,
      );
    }

    result[kind] = filePath;
  }

  return result;
}

function emptyResult() {
  return { notFound: null, serverError: null };
}
