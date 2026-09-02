import { routeFilePathFromClientModuleId } from "./create-client-boundary-plugin.js";

const CALLER = "createClientAssetManifestPlugin({ manifest, onManifest })";

/**
 * Capture the browser asset graph of a production client build.
 *
 * After Rollup emits the tree-shaken bundle, this plugin records the hashed entry
 * chunk plus, for every route that shipped a lazy page chunk, the chunk file and
 * the static chunks and stylesheets it needs. Server-only and API-only routes are
 * absent because they emit no browser page chunk. Build integration receives the
 * finished manifest through `onManifest` and decides where to persist it; this
 * plugin never serves it to browsers.
 *
 * @param {{ manifest: object[], onManifest: (clientManifest: object) => void }} options
 * @returns {import("vite").Plugin}
 */
export function createClientAssetManifestPlugin(options) {
  const routeIdByFilePath = indexRouteIds(options?.manifest);
  const onManifest = options?.onManifest;
  if (typeof onManifest !== "function") {
    throw new TypeError(
      `[Goribu] ${CALLER} requires onManifest to be the callback that receives the emitted client asset manifest.`,
    );
  }

  return {
    name: "goribu:client-asset-manifest",
    enforce: "post",

    generateBundle(_outputOptions, bundle) {
      let entry = null;
      const pages = {};

      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;

        if (output.isEntry) {
          if (entry !== null) {
            throw new Error(
              "[Goribu] The client build emitted more than one entry chunk. Build Goribu's browser bundle from the single application client entry so the server can resolve one boot module.",
            );
          }
          entry = { file: output.fileName, ...collectGraph(bundle, output.fileName) };
          continue;
        }

        if (!output.isDynamicEntry) continue;
        const routeFilePath = routeFilePathFromClientModuleId(output.facadeModuleId);
        if (routeFilePath === null) continue;

        const routeId = routeIdByFilePath.get(routeFilePath);
        if (routeId === undefined) {
          throw new Error(
            `[Goribu] Emitted client page chunk ${JSON.stringify(output.fileName)} maps to route source ${JSON.stringify(routeFilePath)}, which is absent from the route manifest. Regenerate the client build from the current Goribu manifest.`,
          );
        }
        pages[routeId] = { file: output.fileName, ...collectGraph(bundle, output.fileName) };
      }

      if (entry === null) {
        throw new Error(
          "[Goribu] The client build emitted no entry chunk, so the server cannot resolve a browser boot module. Keep the application client entry as the client build input.",
        );
      }

      onManifest(Object.freeze({ entry, pages }));
    },
  };
}

function indexRouteIds(manifest) {
  if (!Array.isArray(manifest)) {
    throw new TypeError(
      `[Goribu] ${CALLER} requires manifest to be the route array produced by generateManifest().`,
    );
  }

  const routeIdByFilePath = new Map();
  for (const route of manifest) {
    if (
      route !== null &&
      typeof route === "object" &&
      typeof route.id === "string" &&
      typeof route.filePath === "string"
    ) {
      routeIdByFilePath.set(route.filePath, route.id);
    }
  }
  return routeIdByFilePath;
}

// Collect the transitive static-import chunks and stylesheets a chunk needs,
// excluding the chunk itself. Static imports are what the browser must preload
// to run the chunk without a request waterfall.
function collectGraph(bundle, rootFileName) {
  const seen = new Set([rootFileName]);
  const queue = [rootFileName];
  const imports = [];
  const css = new Set();

  while (queue.length > 0) {
    const chunk = bundle[queue.shift()];
    if (!chunk || chunk.type !== "chunk") continue;

    for (const styleFile of chunk.viteMetadata?.importedCss ?? []) {
      css.add(styleFile);
    }
    for (const dependency of chunk.imports ?? []) {
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      imports.push(dependency);
      queue.push(dependency);
    }
  }

  return { imports, css: [...css] };
}
