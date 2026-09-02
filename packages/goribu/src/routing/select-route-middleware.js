import { dirname, isAbsolute, relative, sep } from "node:path";

/**
 * Select the discovered middleware scopes that apply to one manifest route.
 *
 * A middleware module applies when its directory is the route file's directory
 * or one of its ancestors. Results are returned outermost-first for later module
 * binding and export flattening; this helper does not load or inspect modules.
 *
 * @param {{
 *   route: { id?: string, filePath: string },
 *   middleware: Array<{ filePath: string, relativePath: string }>,
 * }} options
 * @returns {Array<{ filePath: string, relativePath: string }>}
 */
export function selectRouteMiddleware(options) {
  const route = options?.route;
  const middleware = options?.middleware;

  if (
    route === null ||
    typeof route !== "object" ||
    typeof route.filePath !== "string" ||
    route.filePath.length === 0
  ) {
    throw new TypeError(
      "[Goribu] selectRouteMiddleware({ route, middleware }) requires a manifest route with a non-empty filePath. Pass one route entry returned by generateManifest().",
    );
  }
  if (!Array.isArray(middleware)) {
    throw new TypeError(
      "[Goribu] selectRouteMiddleware({ route, middleware }) requires the array returned by scanMiddleware(). Pass [] when the route tree has no middleware.",
    );
  }

  const routeDirectory = dirname(route.filePath);
  const selected = [];

  for (let index = 0; index < middleware.length; index += 1) {
    const record = middleware[index];
    assertMiddlewareRecord(record, index);

    const distance = ancestorDistance(dirname(record.filePath), routeDirectory);
    if (distance !== null) selected.push({ record, distance });
  }

  return selected
    .sort((a, b) => b.distance - a.distance)
    .map(({ record }) => record);
}

function ancestorDistance(scopeDirectory, routeDirectory) {
  const relativeDirectory = relative(scopeDirectory, routeDirectory);
  if (relativeDirectory === "") return 0;
  if (
    relativeDirectory === ".." ||
    relativeDirectory.startsWith(`..${sep}`) ||
    isAbsolute(relativeDirectory)
  ) {
    return null;
  }

  return relativeDirectory.split(sep).length;
}

function assertMiddlewareRecord(record, index) {
  if (
    record !== null &&
    typeof record === "object" &&
    typeof record.filePath === "string" &&
    record.filePath.length > 0 &&
    typeof record.relativePath === "string" &&
    record.relativePath.length > 0
  ) {
    return;
  }

  throw new TypeError(
    `[Goribu] Middleware discovery record at index ${index} is invalid. ` +
      "Pass the array returned by scanMiddleware() without changing it.",
  );
}
