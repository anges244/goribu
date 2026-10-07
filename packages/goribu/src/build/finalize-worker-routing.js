import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { generateManifest } from "../routing/generate-manifest.js";
import { scanErrorPages } from "../routing/scan-error-pages.js";
import { planWorkerRouting } from "./plan-worker-routing.js";
import { startPrerenderWorker } from "./prerender-static-routes.js";

const ROUTES_DIRECTORY = join("src", "routes");
const NOT_FOUND_ASSET = "404.html";

/**
 * Decide which requests invoke the Worker, after static output is final.
 *
 * Cloudflare sends requests matching the planned patterns to the Worker and
 * answers every other miss from Static Assets with the nearest 404.html. That
 * page is rendered once by the built Worker and owned by Goribu, so no other
 * 404.html may exist at any depth. A miss page that cannot render without a
 * request fails the build instead of quietly invoking the Worker for every URL.
 * Writing the file does not prove Cloudflare serves it (.assetsignore can drop
 * it), so the build requests a miss through the emitted configuration's real
 * asset router and requires that exact page back.
 * A root parameter keeps default asset-first routing, which needs no snapshot.
 *
 * @param {{
 *   projectRoot: string,
 *   prerendered: Array<{ id: string }>,
 *   outputs: { configPath: string, clientDir: string },
 *   log?: { warn: Function, log: Function },
 *   startWorker?: Function,
 * }} options
 */
export async function finalizeWorkerRouting({ projectRoot, prerendered, outputs, log = console, startWorker = startPrerenderWorker }) {
  const root = resolve(projectRoot);
  const routesDir = join(root, ROUTES_DIRECTORY);
  const { configPath, clientDir } = outputs;
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const assetPaths = listAssets(clientDir);

  const plan = planWorkerRouting({
    manifest: generateManifest({ routesDir, projectRoot: root }),
    staticRouteIds: new Set(prerendered.map((route) => route.id)),
    assetPaths,
    r2: Array.isArray(config.r2_buckets) && config.r2_buckets.length > 0,
  });
  for (const warning of plan.warnings) log.warn(warning);

  let html;
  if (plan.patterns !== null) {
    const taken = assetPaths.find((path) => path === NOT_FOUND_ASSET || path.endsWith(`/${NOT_FOUND_ASSET}`));
    if (taken !== undefined) {
      throw new Error(
        `[Goribu] The asset "${taken}" would replace the page served for unknown URLs${taken === NOT_FOUND_ASSET ? "" : " below its directory"}. ` +
          "Goribu builds that page from src/routes/_404.jsx. Rename or remove the file in public/, or rename the route that produces it.",
      );
    }
    const notFound = scanErrorPages(routesDir).notFound;
    html = await renderMissPage(startWorker, configPath, notFound === null ? "built-in 404 page" : `_404 page "${relative(root, notFound)}"`);
    writeFileSync(join(clientDir, NOT_FOUND_ASSET), html, "utf8");
  }

  config.assets = {
    ...config.assets,
    not_found_handling: plan.notFoundHandling,
    ...(plan.patterns === null ? {} : { run_worker_first: plan.patterns }),
  };
  writeFileSync(configPath, `${JSON.stringify(config)}\n`, "utf8");
  if (plan.patterns !== null) {
    await assertMissPageServed(startWorker, configPath, html);
    log.log(`[Goribu] Unknown URLs outside ${plan.patterns.length} Worker routing rule(s) receive the static 404 page without invoking the Worker.`);
  }
  return plan;
}

async function renderMissPage(startWorker, configPath, label) {
  const worker = await startWorker({ configPath });
  try {
    let response;
    try {
      response = await worker.fetch("/_goribu/build/not-found");
    } catch (cause) {
      throw new Error(
        `[Goribu] The prerender runtime failed while rendering the ${label}. The workerd harness may have crashed; re-run the build. ${cause.message}`,
        { cause },
      );
    }
    const fail = (reason) => new Error(
      `[Goribu] The ${label} ${reason} when it was rendered at build time. Static Assets serves this page for unknown URLs, ` +
        "so it must render without request data or runtime bindings. Keep request-specific not-found pages in handlers with res.notFound(props).",
    );
    if (response.status !== 404) {
      const detail = (await response.text().catch(() => "")).trim();
      throw fail(`responded ${response.status}${detail ? ` (${detail})` : ""}`);
    }
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/html")) throw fail("did not return an HTML page");
    try {
      return await response.text();
    } catch (cause) {
      throw fail(`failed while streaming its response (${cause.message})`);
    }
  } finally {
    await worker.stop();
  }
}

async function assertMissPageServed(startWorker, configPath, html) {
  const frontDoor = await startWorker({ configPath, frontDoor: true });
  try {
    // A reserved framework path is never a route or an asset. Without the build
    // binding, the Worker answers it with an empty 404 rather than this page.
    const response = await frontDoor.fetch("/_goribu/build/not-found");
    if (response.status !== 404 || await response.text() !== html) {
      throw new Error(
        `[Goribu] Static Assets does not serve the generated ${NOT_FOUND_ASSET} for unknown URLs, so they would invoke the Worker. ` +
          `Remove any pattern in public/.assetsignore that excludes ${NOT_FOUND_ASSET}.`,
      );
    }
  } finally {
    await frontDoor.stop();
  }
}

function listAssets(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listAssets(join(directory, entry.name), path);
    return entry.isFile() ? [path] : [];
  });
}
