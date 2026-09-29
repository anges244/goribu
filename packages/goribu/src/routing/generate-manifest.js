import { readFileSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { ROUTE_EXTENSION, scanRoutes } from "./scan-routes.js";
import { analyzeRouteModule } from "./analyze-route-module.js";
import { HANDLER_METHODS } from "./handler-methods.js";

const DYNAMIC_SEGMENT = /^\[([A-Za-z0-9_]+)\]$/;

/**
 * Discover and describe every URL route in an application's route tree.
 *
 * This array is called a manifest because it is the framework's precomputed
 * inventory of route modules and the facts needed to use them. Generating it
 * once keeps later build and runtime steps from rescanning files, reinterpreting
 * filename conventions, or parsing exports independently.
 *
 * Route IDs are stable source paths derived relative to the project root.
 * Manifest entries retain absolute file paths only so later build steps can load
 * the corresponding modules. Entries are conflict-checked and sorted in matching precedence:
 * static segments before dynamic segments, then shorter prefixes first.
 *
 * @param {{ routesDir: string, projectRoot: string }} options Paths defining the route tree.
 * @returns {Array<{
 *   id: string,
 *   filePath: string,
 *   pattern: string,
 *   segments: Array<
 *     { type: "static", value: string } |
 *     { type: "dynamic", name: string }
 *   >,
 *   hasDefaultExport: boolean,
 *   methods: string[],
 *   prerenderOverride: boolean | null,
 *   hasUploads: boolean | null,
 *   prerenderEligible: boolean
 * }>}
 */
export function generateManifest(options) {
  const routesDir = options?.routesDir;
  const projectRoot = options?.projectRoot;

  if (
    typeof routesDir !== "string" ||
    routesDir.length === 0 ||
    typeof projectRoot !== "string" ||
    projectRoot.length === 0
  ) {
    throw new TypeError(
      "[Goribu] generateManifest({ routesDir, projectRoot }) requires non-empty paths " +
        "for the application's routes directory and project root.",
    );
  }

  assertRoutesInsideProject(routesDir, projectRoot);

  const routes = scanRoutes(routesDir).map((route) =>
    createManifestEntry(route, projectRoot),
  );
  assertNoConflicts(routes);
  return routes.sort(compareSpecificity);
}

/**
 * Reject swapped or unrelated paths before scanning. Otherwise a caller could
 * accidentally treat the whole project as a route tree and generate plausible
 * but incorrect entries instead of seeing the configuration mistake.
 */
function assertRoutesInsideProject(routesDir, projectRoot) {
  const projectRelativeRoutesDir = relative(projectRoot, routesDir);
  if (!isOutsideProject(projectRelativeRoutesDir)) return;

  throw new Error(
    `[Goribu] Cannot generate a route manifest because the routes directory ` +
      `"${routesDir}" is outside the project root "${projectRoot}". ` +
      `Pass the correct routes directory and project root.`,
  );
}

/**
 * Combine one discovered file's URL shape with its module exports.
 *
 * Keeping both kinds of facts in one entry gives every later step one source of
 * truth: matching uses the URL shape, dispatch uses the exports, and build tools
 * use the source identity, prerender override, and derived eligibility.
 */
function createManifestEntry(discoveredRoute, projectRoot) {
  const id = routeId(discoveredRoute.filePath, projectRoot);
  const segments = routeSegments(discoveredRoute.relativePath, id);
  const analysis = analyzeRouteModule(readRouteSource(discoveredRoute.filePath, id), id);

  assertUsableRouteModule(analysis, id);

  const nonGetMethods = analysis.methods.filter((method) => method !== "GET");
  if (analysis.prerender === true && nonGetMethods.length > 0) {
    throw new Error(
      `[Goribu] Route "${id}" sets \`export const prerender = true\` but exports ${nonGetMethods.join(", ")} handlers. ` +
        "Static Assets would shadow these handlers. Remove the prerender export to serve this route on the Worker, " +
        "or move the non-GET handlers to a separate action route.",
    );
  }

  // Preserve the explicit override so the build can distinguish an author-requested
  // attempt from an automatic candidate. Separately derive eligibility using only
  // the visible rule: a page without HTTP handlers is an automatic candidate.
  // Static Assets own a matching URL, so emitting HTML there would also shadow
  // its non-GET handlers before the Worker has a chance to dispatch them.
  // Avoiding deeper code heuristics keeps this classification predictable.
  const prerenderEligible =
    analysis.prerender ??
    (analysis.hasDefaultExport && analysis.methods.length === 0);

  return {
    id,
    filePath: discoveredRoute.filePath,
    pattern: routePattern(segments),
    segments,
    hasDefaultExport: analysis.hasDefaultExport,
    // null means an unresolved export needs inspection in the Worker.
    hasUploads: analysis.hasUploads,
    methods: analysis.methods,
    prerenderOverride: analysis.prerender,
    prerenderEligible,
  };
}

/**
 * Derive the canonical source identity from the real project layout so generated
 * metadata and teaching errors always point to an openable project-relative file.
 */
function routeId(filePath, projectRoot) {
  const projectRelativePath = relative(projectRoot, filePath);
  if (projectRelativePath === "" || isOutsideProject(projectRelativePath)) {
    throw new Error(
      `[Goribu] Could not create a route ID for "${filePath}" because it is outside ` +
        `the project root "${projectRoot}". Move the route under the project root or ` +
        `pass the correct project root.`,
    );
  }

  return projectRelativePath.split(sep).join("/");
}

/**
 * Recognize both parent traversal and cross-drive absolute results from
 * path.relative so containment checks behave correctly on every platform.
 */
function isOutsideProject(projectRelativePath) {
  return (
    projectRelativePath === ".." ||
    projectRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(projectRelativePath)
  );
}

/**
 * Reject discovered modules that cannot produce any response. Without this
 * guard they would occupy a live URL while silently having nothing to dispatch.
 */
function assertUsableRouteModule(analysis, id) {
  if (analysis.hasDefaultExport || analysis.methods.length > 0) return;

  throw new Error(
    `[Goribu] Route module "${id}" exports neither a default page nor an HTTP handler. ` +
      `Add a default export, export one of ${HANDLER_METHODS.join(", ")}, or move ` +
      `the file outside the routes directory.`,
  );
}

/**
 * Remove filesystem-only details and describe the URL one segment at a time.
 *
 * Later matching code should not need to understand extensions, terminal index
 * files, or bracket syntax. Normalizing those conventions here gives it a small,
 * explicit distinction between literal segments and captured parameters.
 */
function routeSegments(relativePath, id) {
  const pathWithoutExtension = relativePath.replace(ROUTE_EXTENSION, "");
  const rawSegments = pathWithoutExtension.split("/");

  // Only a terminal index filename maps to its containing folder. A directory
  // named index remains a literal URL segment.
  if (rawSegments.at(-1) === "index") rawSegments.pop();

  const segments = rawSegments.map((segment) => parseSegment(segment, id));
  assertUniqueParameterNames(segments, id);
  return segments;
}

/**
 * Recognize Goribu's single-segment [param] syntax and reject bracket forms
 * that would otherwise look supported while producing surprising static URLs.
 */
function parseSegment(segment, id) {
  const dynamic = DYNAMIC_SEGMENT.exec(segment);
  if (dynamic) return { type: "dynamic", name: dynamic[1] };

  if (segment.includes("[") || segment.includes("]")) {
    throw new Error(
      `[Goribu] Unsupported route segment "${segment}" in "${id}". ` +
        `Use a static name or one dynamic \`[param]\` segment containing only ` +
        `letters, numbers, and underscores; catch-all and optional segments are not supported.`,
    );
  }

  return { type: "static", value: segment };
}

/**
 * Ensure every captured value has its own key. Reusing a name would make the
 * matcher silently overwrite the first value when it builds the params object.
 */
function assertUniqueParameterNames(segments, id) {
  const names = new Set();

  for (const segment of segments) {
    if (segment.type !== "dynamic") continue;

    if (names.has(segment.name)) {
      throw new Error(
        `[Goribu] Duplicate route parameter "${segment.name}" in "${id}". ` +
          `Rename each \`[param]\` segment so every parameter name is unique.`,
      );
    }

    names.add(segment.name);
  }
}

/**
 * Build the human-readable URL pattern used in errors and generated metadata.
 *
 * Structured segments remain the matching source of truth; this parallel string
 * exists so users can recognize `/posts/:id` without reading internal objects.
 */
function routePattern(segments) {
  if (segments.length === 0) return "/";

  return `/${segments
    .map((segment) =>
      segment.type === "static" ? segment.value : `:${segment.name}`,
    )
    .join("/")}`;
}

/**
 * Reject routes that match the same URL structure. Parameter names are labels,
 * not constraints, so [id] and [slug] cannot distinguish two routes.
 */
function assertNoConflicts(routes) {
  const routesBySignature = new Map();

  for (const route of routes) {
    const signature = conflictSignature(route.segments);
    const existing = routesBySignature.get(signature);

    if (existing) {
      throw new Error(
        `[Goribu] Route conflict: "${existing.id}" (${existing.pattern}) and ` +
          `"${route.id}" (${route.pattern}) resolve to the same URL shape. ` +
          `Dynamic parameter names do not distinguish routes; remove or rename one route file.`,
      );
    }

    routesBySignature.set(signature, route);
  }
}

/**
 * Create a structural lookup key so ambiguity is rejected during generation,
 * before any request can encounter it. Static values affect which URLs match,
 * while dynamic names do not, so [id] and [slug] deliberately get the same key.
 */
function conflictSignature(segments) {
  return JSON.stringify(
    segments.map((segment) =>
      segment.type === "static" ? ["static", segment.value] : ["dynamic"],
    ),
  );
}

/**
 * Order routes for deterministic, most-specific-first matching in the next
 * substep. Static segments win at the same position; otherwise source IDs make
 * non-overlapping peers stable, and a route precedes its longer descendants.
 */
function compareSpecificity(a, b) {
  const sharedLength = Math.min(a.segments.length, b.segments.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const aSegment = a.segments[index];
    const bSegment = b.segments[index];

    if (aSegment.type !== bSegment.type) {
      return aSegment.type === "static" ? -1 : 1;
    }

    if (
      aSegment.type === "static" &&
      bSegment.type === "static" &&
      aSegment.value !== bSegment.value
    ) {
      return compareStrings(aSegment.value, bSegment.value);
    }
  }

  if (a.segments.length !== b.segments.length) {
    return a.segments.length - b.segments.length;
  }

  return compareStrings(a.id, b.id);
}

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Keep file reading behind one error boundary because a route can disappear or
 * become unreadable between discovery and analysis. The canonical ID makes that
 * low-level filesystem failure actionable to the application author.
 */
function readRouteSource(filePath, id) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (cause) {
    throw new Error(
      `[Goribu] Could not read route module "${id}". ` +
        `Make sure the file exists and is readable, then try again. ${cause.message}`,
      { cause },
    );
  }
}
