import { createClientRouteModuleId } from "./create-client-boundary-plugin.js";

const CALLER = "generateClientPageManifestSource(manifest)";

/**
 * Generate the browser-side route ID to lazy page-loader map.
 *
 * The canonical route manifest remains the only route inventory. API-only
 * modules are deliberately absent because browser navigation can render only a
 * route with a default page export.
 *
 * @param {object[]} manifest
 * @returns {string}
 */
export function generateClientPageManifestSource(manifest) {
  const pages = collectPages(manifest);
  const lines = ["export const pageLoaders = Object.freeze({"];

  for (const route of pages) {
    lines.push(
      `  ${JSON.stringify(route.id)}: () => import(${JSON.stringify(createClientRouteModuleId(route.filePath))}),`,
    );
  }

  lines.push("});", "");
  return lines.join("\n");
}

function collectPages(manifest) {
  if (!Array.isArray(manifest)) {
    throw new TypeError(
      `[Goribu] ${CALLER} requires the route array returned by generateManifest(). Generate the manifest before preparing client page loaders.`,
    );
  }

  const routeIds = new Set();
  const routeSources = new Set();
  const pages = [];

  for (let index = 0; index < manifest.length; index += 1) {
    const route = manifest[index];
    if (
      route === null ||
      typeof route !== "object" ||
      Array.isArray(route) ||
      typeof route.id !== "string" ||
      route.id.length === 0 ||
      typeof route.filePath !== "string" ||
      route.filePath.length === 0 ||
      typeof route.hasDefaultExport !== "boolean"
    ) {
      throw new TypeError(
        `[Goribu] Route at manifest index ${index} cannot become client build data. Pass the unchanged entries returned by generateManifest(), including id, filePath, and hasDefaultExport.`,
      );
    }

    if (routeIds.has(route.id)) {
      throw new Error(
        `[Goribu] Cannot generate client page loaders because route ID ${JSON.stringify(route.id)} appears more than once. Regenerate the manifest so every route has one stable source ID.`,
      );
    }
    if (routeSources.has(route.filePath)) {
      throw new Error(
        `[Goribu] Cannot generate client page loaders because route source ${JSON.stringify(route.filePath)} appears more than once. Regenerate the manifest so every source produces one route entry.`,
      );
    }

    routeIds.add(route.id);
    routeSources.add(route.filePath);
    if (route.hasDefaultExport) {
      pages.push({ id: route.id, filePath: route.filePath });
    }
  }

  return pages;
}
