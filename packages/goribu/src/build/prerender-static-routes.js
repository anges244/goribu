import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { generateManifest } from "../routing/generate-manifest.js";
import { matchRoute } from "../routing/match-route.js";
import { planStaticRoutes } from "./plan-static-routes.js";
import { selectMiddlewareByRoute } from "./select-middleware-by-route.js";
import { createStaticNavigationOutput } from "./static-navigation-output.js";

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
 * Fields from the app's `wrangler` block other than vars are withheld from the
 * build's Worker (see `startPrerenderWorker`), so a page that uses one of those
 * bindings fails to render; the failure names them.
 *
 * @param {{
 *   projectRoot: string,
 *   withheld?: { fields: string[], bindings: string[] },
 *   log?: { warn: Function, log: Function },
 *   startWorker?: Function,
 * }} options
 * @returns {Promise<{
 *   prerendered: Array<{ id: string, assetPath: string, bytes: number }>,
 *   downgraded: Array<{ id: string, pattern: string, reason: string }>,
 *   outputs: { configPath: string, clientDir: string, workerFile: string },
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
  const withheld = options?.withheld ?? { fields: [], bindings: [] };

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

  const outputs = locateBuildOutputs(root);
  const { configPath, clientDir } = outputs;

  // Fail closed on any published HTML asset that owns a route's URL, before this
  // step writes its own output into the same directory.
  assertNoAssetRouteCollisions({ clientDir, manifest });
  const navigationOutput = createStaticNavigationOutput(clientDir);

  // Structural downgrades (no build-time URL) are known before rendering anything.
  const allDowngraded = [...downgraded];
  for (const route of downgraded) announceDowngrade(log, route);

  const inspectUploads = manifest.some((route) => route.hasUploads !== false);
  const uploadManifestPath = join(dirname(configPath), "r2-uploads.json");
  if (!inspectUploads) {
    // A fresh empty inventory is useful to deploy too, without executing app
    // code merely to prove what route analysis already knows.
    writeFileSync(uploadManifestPath, JSON.stringify({ version: 1, builtAt: new Date().toISOString(), routes: [] }, null, 2) + "\n");
  }
  if (staticRoutes.length === 0 && !inspectUploads) {
    navigationOutput.finish();
    log.log("[Goribu] No routes were statically output; every route renders on the Worker.");
    return { prerendered: [], downgraded: allDowngraded, outputs };
  }

  const prerendered = [];
  const worker = await startWorker({ configPath, withheld: withheld.fields });
  try {
    if (inspectUploads) {
      // Evaluate every route's policy in the emitted Worker, including action-only
      // apps with no prerender candidates. Never import app server code into Node.
      const response = await worker.fetch("/_goribu/build/uploads");
      if (![200, 400].includes(response.status) || !response.headers.get("content-type")?.startsWith("application/json")) {
        throw new Error("[Goribu] Could not inspect upload policies in the built Worker. Rebuild with matching Goribu build and runtime versions.");
      }
      let uploads;
      try {
        uploads = await response.json();
      } catch (cause) {
        throw new Error("[Goribu] The built Worker returned malformed upload metadata. Rebuild with matching Goribu build and runtime versions.", { cause });
      }
      if (response.status === 400 && uploads?.version === 1 && typeof uploads.error === "string" && uploads.error.startsWith("[Goribu]")) {
        throw new Error(uploads.error);
      }
      if (response.status !== 200 || uploads?.version !== 1 || !Array.isArray(uploads.routes)) {
        throw new Error("[Goribu] The built Worker returned an invalid upload manifest. Rebuild with matching Goribu build and runtime versions.");
      }
      writeFileSync(uploadManifestPath, JSON.stringify({ ...uploads, builtAt: new Date().toISOString() }, null, 2) + "\n");
    }
    for (const route of staticRoutes) {
      const result = await renderThroughWorker(worker, route);
      if (!result.ok && withheld.bindings.length > 0) {
        result.reason += `; prerendering runs without the wrangler bindings ${withheld.bindings.join(", ")}, so a page that uses them must render on the Worker`;
      }

      if (result.ok) {
        await navigationOutput.write(route, result.html);
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
  navigationOutput.finish();

  if (prerendered.length === 0) {
    log.log("[Goribu] No routes were statically output; every route renders on the Worker.");
    return { prerendered, downgraded: allDowngraded, outputs };
  }

  log.log(
    `[Goribu] Statically output ${prerendered.length} route(s), served from Static Assets ` +
      `without invoking the Worker: ${prerendered.map((route) => route.assetPath).join(", ")}.`,
  );

  return { prerendered, downgraded: allDowngraded, outputs };
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
  worker.takeError?.();
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
    const diagnostic = response.headers.get("x-goribu-prerender-error");
    if (diagnostic === "r2-signed-url") {
      return { ok: false, reason: "called req.r2.signedUrl(), whose link would expire inside static HTML" };
    }
    if (diagnostic === "incomplete-render") {
      return { ok: false, reason: "reported an error inside a Suspense boundary, so its HTML would contain only the fallback" };
    }
    const error = worker.takeError?.();
    return { ok: false, reason: `responded ${response.status}${error ? ` (${error})` : ""}` };
  }
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/html")) {
    return { ok: false, reason: "did not return an HTML page" };
  }
  if (response.headers.has("set-cookie")) {
    return { ok: false, reason: "set a request-time cookie" };
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
 *
 * frontDoor requests instead pass through the Static Assets router as public
 * traffic would, without the build-only binding, so the build can prove what
 * the emitted routing configuration actually serves.
 *
 * `withheld` top-level fields are removed from an in-memory copy of the config,
 * never from the deploy file. Prerendering then needs no Cloudflare credentials
 * and never reaches the production resources those bindings name.
 */
export async function startPrerenderWorker({ configPath, frontDoor = false, withheld = [] }) {
  const { createTestHarness } = await import("wrangler");

  // Keep the harness's own informational logging out of the build output, without
  // hiding its errors, unless the developer set a level themselves. Restored when
  // the Worker stops so the process is left as it was found.
  // Static candidates have no handlers, so they cannot query. Never use the
  // developer's database; Miniflare requires credentials even for a placeholder.
  const placeholder = "postgres://goribu:goribu@prerender.invalid:5432/goribu";
  const restoreEnvironment = overrideEnvironment({
    WRANGLER_LOG: process.env.WRANGLER_LOG ?? "error",
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_POSTGRES: placeholder,
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_POSTGRES_CACHED: placeholder,
  });

  let harness;
  let url;
  try {
    const buildVars = frontDoor ? {} : { __GORIBU_PRERENDER: true };
    harness = createTestHarness(withheld.length === 0
      ? { workers: [{ configPath, ...(frontDoor ? {} : { vars: buildVars }) }] }
      : { root: dirname(configPath), workers: [{ config: withholdFields(configPath, withheld, buildVars) }] });
    ({ url } = await harness.listen());
  } catch (error) {
    restoreEnvironment();
    throw error;
  }
  const worker = harness.getWorker();

  return {
    fetch(pathname) {
      if (frontDoor) return fetch(new URL(pathname, url), { redirect: "manual" });
      // The direct Worker handle dispatches straight to the Worker, bypassing the
      // Static Assets front door, so a route renders through the Worker even after
      // its own static file has been written into the asset directory. Manual
      // redirect keeps the Worker's trailing-slash canonicalization visible as a
      // non-200 downgrade signal rather than silently followed.
      return worker.fetch(pathname, { redirect: "manual" });
    },
    // The last error the Worker logged since the previous call, reduced to its
    // innermost cause, which names what actually failed during a render.
    takeError() {
      const logged = harness.getLogs().filter((entry) => entry.level === "error").at(-1)?.message;
      harness.clearLogs();
      if (typeof logged !== "string") return null;
      const cause = [...logged.matchAll(/\[cause\]: ([^\n]+)/g)].at(-1)?.[1] ?? logged.split("\n")[0];
      return cause.trim().slice(0, 300);
    },
    async stop() {
      try {
        await harness.close();
      } finally {
        restoreEnvironment();
      }
    },
  };
}

function withholdFields(configPath, fields, vars) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  for (const field of fields) delete config[field];
  config.vars = { ...config.vars, ...vars };
  return config;
}

function overrideEnvironment(values) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
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

  if (typeof wrangler.main !== "string" || wrangler.main.length === 0) {
    throw new Error(`[Goribu] The built Worker configuration at "${configPath}" has no main entry. Run goribu build with Goribu's Worker environment enabled.`);
  }

  return {
    configPath,
    clientDir: resolve(dirname(configPath), assetsDirectory),
    workerFile: resolve(dirname(configPath), wrangler.main),
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
