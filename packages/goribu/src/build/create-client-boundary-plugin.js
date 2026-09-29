import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const CLIENT_ROUTE_PREFIX = "virtual:goribu/client-route:";
const RESOLVED_CLIENT_ROUTE_PREFIX = `\0${CLIENT_ROUTE_PREFIX}`;
const SERVER_MODULE_PATTERN = /\.server\.(?:[cm]?js|jsx|[cm]?ts|tsx)(?:[?#]|$)/i;
const CALLER = "createClientBoundaryPlugin({ routesDir })";

/**
 * Create the virtual browser entry for one route page.
 *
 * @param {string} routeFilePath
 * @returns {string}
 */
export function createClientRouteModuleId(routeFilePath) {
  if (typeof routeFilePath !== "string" || !isAbsolute(routeFilePath)) {
    throw new TypeError(
      "[Goribu] createClientRouteModuleId(routeFilePath) requires an absolute route file path. Pass the filePath from Goribu's generated route manifest.",
    );
  }

  return `${CLIENT_ROUTE_PREFIX}${encodeURIComponent(routeFilePath)}`;
}

/**
 * Recover the route file path a bundled chunk fronts, or null when the module ID
 * is not one of Goribu's virtual client-route entries. Lets build integration
 * map an emitted page chunk back to its canonical manifest route.
 *
 * @param {unknown} moduleId
 * @returns {string|null}
 */
export function routeFilePathFromClientModuleId(moduleId) {
  if (
    typeof moduleId !== "string" ||
    !moduleId.startsWith(RESOLVED_CLIENT_ROUTE_PREFIX)
  ) {
    return null;
  }

  try {
    return decodeRouteFilePath(
      moduleId.slice(RESOLVED_CLIENT_ROUTE_PREFIX.length),
    );
  } catch {
    return null;
  }
}

/**
 * Keep server-only modules out of Goribu's browser bundle.
 *
 * Virtual route entries expose only the route's default page export, so named
 * handlers are not retained as client entry exports. `.server.*` imports resolved
 * from route modules are marked side-effect-free so Rollup can remove handler-only
 * dependencies. Browser-reachable non-route imports fail immediately, and the
 * final bundle audit fails closed if a server-only module survives tree-shaking.
 *
 * @param {{ routesDir: string }} options
 * @returns {import("vite").Plugin}
 */
export function createClientBoundaryPlugin(options) {
  const routesDir = assertRoutesDir(options?.routesDir);

  return {
    name: "goribu:client-boundary",
    enforce: "pre",

    async resolveId(source, importer, resolveOptions) {
      if (source.startsWith(RESOLVED_CLIENT_ROUTE_PREFIX)) return source;
      if (source.startsWith(CLIENT_ROUTE_PREFIX)) return `\0${source}`;

      if (this.environment?.name !== "client") return null;

      const resolved = await this.resolve(source, importer, {
        ...resolveOptions,
        skipSelf: true,
      });
      if (
        resolved === null ||
        resolved.external === true ||
        !isServerModule(resolved.id)
      ) {
        return null;
      }

      if (isWithinDirectory(routesDir, importer)) {
        return { ...resolved, moduleSideEffects: false };
      }

      throw createServerLeakError(resolved.id, importer);
    },

    load(id) {
      if (!id.startsWith(RESOLVED_CLIENT_ROUTE_PREFIX)) return null;

      const routeFilePath = decodeRouteFilePath(
        id.slice(RESOLVED_CLIENT_ROUTE_PREFIX.length),
      );
      if (!isWithinDirectory(routesDir, routeFilePath)) {
        throw new Error(
          `[Goribu] Client route ${JSON.stringify(routeFilePath)} is outside the configured routes directory ${JSON.stringify(routesDir)}. Regenerate client route entries from the current Goribu manifest instead of constructing virtual IDs manually.`,
        );
      }

      return `export { default } from ${JSON.stringify(routeFilePath)};\n`;
    },

    outputOptions(options) {
      if (this.environment?.name !== "client") return null;
      // Tree-shaking removes handlers and upload key functions from executable
      // chunks, but source maps otherwise republish the original route module.
      // Keep mappings for local debugging without embedding server source text.
      return { ...options, sourcemapExcludeSources: true };
    },

    generateBundle(_outputOptions, bundle) {
      if (this.environment?.name !== "client") return;

      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const moduleId of Object.keys(output.modules)) {
          if (isServerModule(moduleId)) {
            throw createServerLeakError(moduleId, "the generated client bundle");
          }
        }
      }
    },
  };
}

function assertRoutesDir(routesDir) {
  if (typeof routesDir !== "string" || !isAbsolute(routesDir)) {
    throw new TypeError(
      `[Goribu] ${CALLER} requires routesDir to be an absolute path. Resolve the application's route directory before creating the client build plugins.`,
    );
  }
  return realpathOrFallback(resolve(routesDir));
}

function decodeRouteFilePath(encodedPath) {
  let routeFilePath;
  try {
    routeFilePath = decodeURIComponent(encodedPath);
  } catch (cause) {
    throw new TypeError(
      "[Goribu] Cannot load the client route because its virtual module ID is malformed. Regenerate client entries with createClientRouteModuleId(routeFilePath).",
      { cause },
    );
  }

  if (!isAbsolute(routeFilePath)) {
    throw new TypeError(
      "[Goribu] Cannot load the client route because its virtual module ID does not contain an absolute path. Regenerate client entries with createClientRouteModuleId(routeFilePath).",
    );
  }
  return routeFilePath;
}

function isServerModule(moduleId) {
  return SERVER_MODULE_PATTERN.test(moduleId);
}

function isWithinDirectory(directory, candidate) {
  if (typeof candidate !== "string" || candidate.startsWith("\0")) return false;

  const cleanCandidate = candidate.replace(/[?#].*$/, "");
  const comparableCandidate = isAbsolute(cleanCandidate)
    ? realpathOrFallback(resolve(cleanCandidate))
    : cleanCandidate;
  const pathFromDirectory = relative(directory, comparableCandidate);
  return (
    pathFromDirectory === "" ||
    (pathFromDirectory !== ".." &&
      !pathFromDirectory.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromDirectory))
  );
}

function realpathOrFallback(filePath) {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

function createServerLeakError(moduleId, importer) {
  const cleanModuleId = moduleId.replace(/[?#].*$/, "");
  const importedBy =
    typeof importer === "string"
      ? ` It was imported by ${JSON.stringify(importer.replace(/[?#].*$/, ""))}.`
      : "";

  return new Error(
    `[Goribu] Server-only module ${JSON.stringify(cleanModuleId)} reached client code.${importedBy} Files named *.server.{js,jsx,mjs,cjs,ts,tsx,mts,cts} may be imported by route handlers, but page components and their browser dependencies must use client-safe modules. Move the import into a route handler or split the browser-safe code into a separate module.`,
  );
}
