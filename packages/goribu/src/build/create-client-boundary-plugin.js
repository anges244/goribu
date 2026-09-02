import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const SERVER_MODULE_PATTERN = /\.server\.(?:[cm]?js|jsx|[cm]?ts|tsx)(?:[?#]|$)/i;
const CALLER = "createClientBoundaryPlugin({ routesDir })";

/**
 * Keep server-only modules out of Goribu's browser graph.
 *
 * Route modules may import `.server.*` files for named handlers, so those imports
 * are marked side-effect-free and Rollup may remove them when browser-reachable
 * route pages arrive in Block 5. Any other client import fails immediately, and
 * the final bundle audit fails closed if a server-only module survives shaking.
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
