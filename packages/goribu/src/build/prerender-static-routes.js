import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { generateManifest } from "../routing/generate-manifest.js";
import { matchRoute } from "../routing/match-route.js";
import { planStaticRoutes } from "./plan-static-routes.js";
import { selectMiddlewareByRoute } from "./select-middleware-by-route.js";

const ROUTES_DIRECTORY = join("src", "routes");
const DEPLOY_REDIRECT = join(".wrangler", "deploy", "config.json");
const RESERVED_ASSETS_DIR = "_goribu";

/**
 * Produce build-time static output for every route whose first response needs no
 * Worker, after the production build has emitted the Worker and client bundles.
 *
 * Static output is what the build does when a route's first response needs no
 * Worker. Rather than re-rendering the page through a parallel path, this runs the
 * emitted Worker in its real runtime (workerd, via Wrangler) and asks it for each
 * static route, so the output is exactly what the Worker would serve and is
 * compiled through the app's own build. The HTML is written into the client asset
 * directory, where Cloudflare Static Assets serves it directly and the Worker is
 * never invoked for that URL.
 *
 * A candidate is downgraded to Worker rendering — announced with its reason —
 * when it has no single build-time URL (a dynamic segment) or when the Worker
 * cannot render it at build time (it depends on the request or runtime state).
 * Only a route that explicitly forced `prerender = true` fails the build instead
 * of downgrading, because it asserted a guarantee it did not keep.
 *
 * Before writing anything, existing client HTML assets are audited against the
 * route manifest: an app-published HTML file that resolves to a Goribu route's
 * URL would collide with this output or silently shadow a route meant to stay
 * dynamic, so it fails the build.
 *
 * @param {{
 *   projectRoot: string,
 *   log?: { warn: Function, log: Function },
 *   startWorker?: Function,
 * }} options
 * @returns {Promise<{
 *   prerendered: Array<{ id: string, assetPath: string, bytes: number }>,
 *   downgraded: Array<{ id: string, pattern: string, reason: string }>,
 * }>}
 */
export async function prerenderStaticRoutes(options) {
  const projectRoot = options?.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] prerenderStaticRoutes({ projectRoot }) requires the application project root.",
    );
  }
  const log = options?.log ?? console;
  const startWorker = options?.startWorker ?? startPrerenderWorker;

  const root = resolve(projectRoot);
  const routesDir = join(root, ROUTES_DIRECTORY);

  const manifest = generateManifest({ routesDir, projectRoot: root });
  const middlewareByRoute = selectMiddlewareByRoute({
    routesDir,
    manifest,
    projectRoot: root,
  });
  const routesWithMiddleware = new Set(middlewareByRoute.keys());
  const { staticRoutes, downgraded } = planStaticRoutes(manifest, {
    routesWithMiddleware,
    middlewareByRoute,
  });

  const { configPath, clientDir } = locateBuildOutputs(root);

  // Fail closed on any published HTML asset that owns a route's URL, before this
  // step writes its own output into the same directory.
  assertNoAssetRouteCollisions({ clientDir, manifest });

  // Structural downgrades (no build-time URL) are known before rendering anything.
  const allDowngraded = [...downgraded];
  for (const route of downgraded) announceDowngrade(log, route);

  if (staticRoutes.length === 0) {
    log.log("[Goribu] No routes were statically output; every route renders on the Worker.");
    return { prerendered: [], downgraded: allDowngraded };
  }

  const prerendered = [];
  const worker = await startWorker({ configPath });
  try {
    for (const route of staticRoutes) {
      const result = await renderThroughWorker(worker, route);

      if (result.ok) {
        const outputFile = join(clientDir, route.assetPath);
        mkdirSync(dirname(outputFile), { recursive: true });
        writeFileSync(outputFile, result.html, "utf8");
        prerendered.push({ id: route.id, assetPath: route.assetPath, bytes: Buffer.byteLength(result.html) });
        continue;
      }

      // A route that forced prerendering asserted the Worker can build its
      // response with no request. Failing to render is a broken promise, not a
      // reason to quietly serve it dynamically.
      if (route.forced) {
        throw new Error(
          `[Goribu] Route "${route.id}" (${route.pattern}) sets \`export const prerender = true\`, but the ` +
            `Worker ${result.reason} when it was rendered at build time. Fix the page so it renders with no ` +
            "request, or remove the prerender export to serve it on the Worker.",
        );
      }

      const downgrade = {
        id: route.id,
        pattern: route.pattern,
        reason: `the Worker ${result.reason} when it was rendered at build time`,
      };
      allDowngraded.push(downgrade);
      announceDowngrade(log, downgrade);
    }
  } finally {
    await worker.stop();
  }

  if (prerendered.length === 0) {
    log.log("[Goribu] No routes were statically output; every route renders on the Worker.");
    return { prerendered, downgraded: allDowngraded };
  }

  log.log(
    `[Goribu] Statically output ${prerendered.length} route(s), served from Static Assets ` +
      `without invoking the Worker: ${prerendered.map((route) => route.assetPath).join(", ")}.`,
  );

  return { prerendered, downgraded: allDowngraded };
}

function announceDowngrade(log, route) {
  log.warn(
    `[Goribu] Route "${route.id}" (${route.pattern}) is a prerender candidate but was not ` +
      `statically output: ${route.reason}. It will render on the Worker at request time.`,
  );
}

/**
 * Ask the running Worker for one static route and return its complete HTML, or a
 * reason it could not be statically output. Only a plain 200 response whose body
 * is fully read is static; a redirect, an error status, or a body that fails
 * mid-stream means the route needs the Worker at request time.
 *
 * A rejected fetch is different in kind: it means the workerd harness or its
 * connection failed, not that this route cannot render. Downgrading on it would
 * hide a dead runtime and silently fall every remaining route back to the Worker,
 * so it fails the build with a repair instruction instead.
 */
async function renderThroughWorker(worker, route) {
  let response;
  try {
    response = await worker.fetch(route.pathname);
  } catch (cause) {
    throw new Error(
      `[Goribu] The prerender runtime failed to answer for "${route.pathname}". ` +
        `The workerd harness may have crashed; re-run the build. ${cause.message}`,
      { cause },
    );
  }

  if (response.status !== 200) {
    return { ok: false, reason: `responded ${response.status}` };
  }

  let html;
  try {
    html = await response.text();
  } catch (cause) {
    // React can flush a 200 shell and then throw while the body streams, for
    // example a component that fails below a Suspense boundary. That is this
    // route failing to render, so it downgrades like any other render failure —
    // and, crucially, does not abandon the routes still queued behind it.
    return { ok: false, reason: `failed while streaming its response (${cause.message})` };
  }

  return { ok: true, html };
}

/**
 * The default Worker runner: start the emitted Worker in workerd through
 * Wrangler's test harness, from the build's own generated Wrangler config, so
 * static output is rendered by the real artifact in its real runtime. Injectable
 * so the orchestration can be tested without starting workerd.
 */
async function startPrerenderWorker({ configPath }) {
  const { createTestHarness } = await import("wrangler");

  // Keep the harness's own informational logging out of the build output, without
  // hiding its errors, unless the developer set a level themselves. Restored when
  // the Worker stops so the process is left as it was found.
  const previousLogLevel = process.env.WRANGLER_LOG;
  process.env.WRANGLER_LOG = previousLogLevel ?? "error";
  const restoreLogLevel = () => {
    if (previousLogLevel === undefined) delete process.env.WRANGLER_LOG;
    else process.env.WRANGLER_LOG = previousLogLevel;
  };

  let harness;
  try {
    harness = createTestHarness({ workers: [{ configPath }] });
    await harness.listen();
  } catch (error) {
    restoreLogLevel();
    throw error;
  }
  const worker = harness.getWorker();

  return {
    fetch(pathname) {
      // The direct Worker handle dispatches straight to the Worker, bypassing the
      // Static Assets front door, so a route renders through the Worker even after
      // its own static file has been written into the asset directory. Manual
      // redirect keeps the Worker's trailing-slash canonicalization visible as a
      // non-200 downgrade signal rather than silently followed.
      return worker.fetch(pathname, { redirect: "manual" });
    },
    async stop() {
      try {
        await harness.close();
      } finally {
        restoreLogLevel();
      }
    },
  };
}

/**
 * Fail the build when an existing client HTML asset resolves to a URL a Goribu
 * route owns. Static Assets take precedence over the Worker, so such a file would
 * either be overwritten by this step's output or silently shadow a route that is
 * supposed to render on the Worker. Both are surprises, so refuse them.
 */
export function assertNoAssetRouteCollisions({ clientDir, manifest }) {
  for (const relativePath of htmlAssetsIn(clientDir)) {
    const pathname = servedPathnameForAsset(relativePath);
    const match = matchRoute({ manifest, pathname, method: "GET" });
    if (match.kind === "not-found") continue;

    throw new Error(
      `[Goribu] The published asset "${relativePath}" is served at "${pathname}", which the route ` +
        `"${match.route.id}" (${match.route.pattern}) also owns. A static asset takes precedence over ` +
        "the Worker, so it would collide with Goribu's static output or shadow a dynamic route. " +
        "Rename or remove the file in public/, or remove the conflicting route.",
    );
  }
}

/**
 * Derive the clean URL that Cloudflare Static Assets serves a given HTML file at,
 * under the `drop-trailing-slash` handling the app is configured with. An
 * `index.html` maps to its directory URL; every other `<name>.html` maps to
 * `/<name>`. Each path segment is percent-encoded so a literal `%`, `?`, or `#`
 * in a file name survives the matcher's decode step and compares as itself.
 */
export function servedPathnameForAsset(relativePath) {
  const segments = relativePath.split(/[\\/]/).filter((segment) => segment.length > 0);
  const last = segments.pop().replace(/\.html$/i, "");
  if (last !== "index") segments.push(last);
  return `/${segments.map(encodeURIComponent).join("/")}`;
}

/**
 * List every `.html` file under the client directory as a forward-slash relative
 * path, skipping Goribu's reserved fingerprinted namespace, which never holds
 * app HTML and is caching-immutable.
 */
function htmlAssetsIn(clientDir) {
  const found = [];

  const walk = (directory, prefix) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return; // No client output yet: nothing to audit.
    }

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (prefix === "" && entry.name === RESERVED_ASSETS_DIR) continue;
        walk(join(directory, entry.name), relativePath);
        continue;
      }
      if (entry.isFile() && /\.html$/i.test(entry.name)) found.push(relativePath);
    }
  };

  walk(clientDir, "");
  return found;
}

/**
 * Find the emitted Wrangler config and the client asset directory from the
 * build's own deploy handoff, rather than reconstructing the bundler's output
 * naming. The deploy redirect points at the generated Wrangler config, which is
 * both the artifact the test harness runs and the source of `assets.directory`,
 * the directory Static Assets are uploaded from.
 */
function locateBuildOutputs(root) {
  const redirectPath = join(root, DEPLOY_REDIRECT);
  const redirect = readJson(
    redirectPath,
    "the build's deploy configuration",
    "Run `goribu build` before prerendering.",
  );

  const configPath = resolve(dirname(redirectPath), redirect.configPath);
  const wrangler = readJson(configPath, "the built Worker's Wrangler configuration", "");

  const assetsDirectory = wrangler.assets?.directory;
  if (typeof assetsDirectory !== "string") {
    throw new Error(
      `[Goribu] The built Worker's Wrangler configuration at "${configPath}" has no ` +
        "`assets.directory`, so there is nowhere to write static output.",
    );
  }

  return {
    configPath,
    clientDir: resolve(dirname(configPath), assetsDirectory),
  };
}

function readJson(filePath, description, repair) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (cause) {
    throw new Error(
      `[Goribu] Could not read ${description} at "${filePath}".${repair ? ` ${repair}` : ""} ${cause.message}`,
      { cause },
    );
  }
}
