import { NAVIGATION_PATH } from "../runtime/resolve-navigation-request.js";
import { matchRoute } from "../routing/match-route.js";

const MAX_PATTERNS = 100;
const MAX_PATTERN_LENGTH = 100;
const STATIC_NAMESPACES = ["/_goribu/assets/*", "/_goribu/navigation/*"];

/**
 * Plan Cloudflare routing from the final route and asset inventories.
 *
 * Only successfully emitted pages belong in staticRouteIds. Failed prerenders
 * must stay on the Worker. assetPaths contains paths relative to the asset
 * directory, including generated HTML. Negative rules take precedence, so an
 * asset that could hide a concrete declared Worker route is an error. Public
 * files keep precedence over parameters, as they do with asset-first routing.
 *
 * This is deliberately a build-only planner. Cloudflare's globs match across
 * slashes, unlike Goribu's single-segment parameters. The Worker still performs
 * exact route matching after Cloudflare admits a request.
 *
 * A null patterns result means omit run_worker_first and use the returned
 * notFoundHandling ("none") to preserve default asset-first routing. Otherwise
 * use the returned array with not_found_handling: "404-page". The caller emits
 * warnings through the build logger; the planner never prints a pattern list.
 */
export function planWorkerRouting({
  manifest,
  staticRouteIds = new Set(),
  assetPaths = [],
  r2 = false,
}) {
  const workerRoutes = manifest.filter((route) => !staticRouteIds.has(route.id));
  const positive = new Set([NAVIGATION_PATH]);
  const warnings = [];

  if (r2) {
    positive.add("/_goribu/r2/file");
    positive.add("/_goribu/r2/upload");
  }

  for (const route of workerRoutes) {
    const pattern = routePattern(route);
    for (const spelling of new Set([pattern, routePattern(route, encodeComponent)])) {
      positive.add(spelling);
      // Admit the canonical route and one trailing slash. A subtree wildcard here
      // would also admit scanner paths beneath an otherwise concrete route.
      if (spelling !== "/" && !spelling.endsWith("*")) positive.add(`${spelling}/`);
    }
    if (route.segments[0]?.type === "dynamic") {
      warnings.push(
        `[Goribu] Route "${route.id}" starts with a root parameter and needs Worker pattern ${pattern}. ` +
        (pattern === "/*"
          ? "Keeping asset-first routing: existing assets bypass the Worker, but unknown URLs invoke it. "
          : "Unknown URLs matching this pattern can invoke the Worker. ") +
        "Use a static path prefix before the parameter to narrow routing.",
      );
    }
  }

  const assetFirst = positive.has("/*");
  // Static Assets would also serve the miss page at its own URL with status 200.
  // Send that one URL to the Worker, which answers it as any other miss.
  if (!assetFirst) positive.add("/404");
  const workerPatterns = removeRedundantPatterns([...positive]);
  const negative = new Set();
  // These namespaces contain only build-owned static files, never handlers.
  // Group them rather than spending one exclusion per content-hashed chunk.
  for (const namespace of STATIC_NAMESPACES) {
    if (workerPatterns.some((pattern) => matches(pattern, namespace.slice(0, -1)))) {
      negative.add(namespace);
    }
  }

  for (const asset of assetPaths) {
    if (asset === "_headers" || asset === "_redirects") continue;
    // In selective routing the miss page is Goribu's; never exclude its URL.
    if (asset === "404.html" && !assetFirst) continue;
    if (STATIC_NAMESPACES.some((namespace) => asset.startsWith(namespace.slice(1, -1)))) continue;
    for (const pathname of assetPathnames(asset)) {
      if (!workerPatterns.some((pattern) => matches(pattern, pathname))) continue;
      const owner = matchRoute({ manifest, pathname, method: "GET" }).route;
      if (owner && !staticRouteIds.has(owner.id) && owner.segments.every((segment) => segment.type === "static")) {
        throw new Error(
          `[Goribu] Static asset "${asset}" at "${pathname}" conflicts with Worker route "${owner.id}". ` +
          "Rename or remove the asset, or make that route static, before building.",
        );
      }
      negative.add(pathname);
    }
  }

  // A catch-all already admits every miss. Default asset-first routing provides
  // that behavior without spending the rule budget on static exclusions. Keep
  // the collision audit above, and omit BOTH selective rules and static 404
  // handling so browser navigations still reach declared Worker routes.
  if (assetFirst) return { patterns: null, notFoundHandling: "none", warnings };

  const patterns = [...workerPatterns, ...removeRedundantPatterns([...negative]).map((path) => `!${path}`)];
  for (const pattern of patterns) {
    if (pattern.length > MAX_PATTERN_LENGTH) {
      throw new Error(
        `[Goribu] Worker routing pattern "${pattern}" exceeds Cloudflare's ${MAX_PATTERN_LENGTH}-character limit. ` +
        "Shorten the route or asset path before building.",
      );
    }
  }
  if (patterns.length > MAX_PATTERNS) {
    throw new Error(
      `[Goribu] Worker routing requires ${patterns.length} patterns; Cloudflare allows at most ${MAX_PATTERNS}, including static exclusions. ` +
      "Reduce the number of Worker routes or overlapping static assets, or reorganize dynamic routes under shared prefixes. " +
      "Goribu will not fall back to invoking the Worker for every request.",
    );
  }
  return { patterns, notFoundHandling: "404-page", warnings };
}

function routePattern(route, encode = encodeSegment) {
  return `/${route.segments.map((segment) => segment.type === "dynamic" ? "*" : encode(segment.value)).join("/")}`;
}

function encodeSegment(segment) {
  // Cloudflare matches URL.pathname without decoding it. Preserve characters a
  // browser leaves literal (such as @, +, comma, = and colon), while protecting
  // filename characters that would otherwise change URL parsing. A final slash
  // prevents URL parsing from trimming whitespace at the end of the segment.
  const escaped = segment.replace(/[%?#\\\u0000-\u0020\u007f]/g, (character) => encodeURIComponent(character));
  return new URL(`/${escaped}/`, "https://goribu.invalid").pathname.slice(1, -1).replace(/\*/g, "%2A");
}

function encodeComponent(segment) {
  // Cloudflare's asset canonicalization and Goribu's prerender URL builder use
  // component escaping. Keep this spelling alongside ordinary browser paths.
  return encodeURIComponent(segment).replace(/\*/g, "%2A");
}

function matches(pattern, pathname) {
  const expression = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${expression}$`).test(pathname);
}

function removeRedundantPatterns(patterns) {
  const unique = [...new Set(patterns)].sort();
  // Cloudflare rejects a rule already covered by the same prefix plus '*'.
  // Only remove proven redundancy; never broaden unrelated routes to fit.
  return unique.filter((pattern) => !unique.some((other) =>
    other !== pattern && other.endsWith("*") &&
    pattern.startsWith(other.slice(0, -1)),
  ));
}

function assetPathnames(asset) {
  const paths = new Set();
  for (const encode of [encodeSegment, encodeComponent]) {
    const encoded = `/${asset.split("/").map(encode).join("/")}`;
    paths.add(encoded);
    if (!asset.endsWith(".html")) continue;
    const clean = encoded.slice(0, -5);
    paths.add(clean);
    paths.add(`${clean}/`);
    if (asset === "index.html") paths.add("/");
    else if (asset.endsWith("/index.html")) {
      const directory = clean.slice(0, -6);
      paths.add(directory);
      paths.add(`${directory}/`);
    }
  }
  return paths;
}
