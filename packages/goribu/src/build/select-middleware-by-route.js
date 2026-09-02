import { relative, sep } from "node:path";
import { scanMiddleware } from "../routing/scan-middleware.js";
import { selectRouteMiddleware } from "../routing/select-route-middleware.js";

/**
 * Select and identify each route's folder-scoped middleware while build-time
 * filesystem paths are still available.
 *
 * The returned sparse map is the shared source of truth for Worker generation
 * and static-route planning. Values remain outermost-first and contain only
 * project-relative identities safe to serialize into the generated Worker.
 *
 * @param {{ routesDir: string, manifest: object[], projectRoot: string }} options
 * @returns {Map<string, Array<{ id: string, relativePath: string }>>}
 */
export function selectMiddlewareByRoute(options) {
  const routesDir = options?.routesDir;
  const manifest = options?.manifest;
  const projectRoot = options?.projectRoot;

  if (
    typeof routesDir !== "string" ||
    routesDir.length === 0 ||
    !Array.isArray(manifest) ||
    typeof projectRoot !== "string" ||
    projectRoot.length === 0
  ) {
    throw new TypeError(
      "[Goribu] selectMiddlewareByRoute({ routesDir, manifest, projectRoot }) requires the routes directory, generated manifest, and project root prepared by the build.",
    );
  }

  const middleware = scanMiddleware(routesDir);
  const middlewareByRoute = new Map();

  for (const route of manifest) {
    const selected = selectRouteMiddleware({ route, middleware });
    if (selected.length === 0) continue;

    middlewareByRoute.set(
      route.id,
      selected.map((record) => ({
        id: routeId(record.filePath, projectRoot),
        relativePath: record.relativePath,
      })),
    );
  }

  return middlewareByRoute;
}

function routeId(filePath, projectRoot) {
  return relative(projectRoot, filePath).split(sep).join("/");
}
