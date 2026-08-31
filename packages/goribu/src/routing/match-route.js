import { HANDLER_METHODS } from "./handler-methods.js";

/**
 * Match one pathname and HTTP method against a generated route manifest.
 *
 * This function only decides what the request means. It does not load modules,
 * call handlers, create Responses, or render pages. Its tagged result gives the
 * later dispatcher one explicit action without making it repeat routing rules.
 *
 * @param {{ manifest: Array<object>, pathname: string, method: string }} options
 * @returns {
 *   | { kind: "handler", route: object, params: object, method: string }
 *   | { kind: "page", route: object, params: object }
 *   | { kind: "automatic-head", route: object, params: object, target: { kind: "handler", method: "GET" } | { kind: "page" } }
 *   | { kind: "automatic-options", route: object, params: object, allowedMethods: string[] }
 *   | { kind: "method-not-allowed", route: object, params: object, allowedMethods: string[] }
 *   | { kind: "not-found" }
 * }
 */
export function matchRoute(options) {
  const manifest = options?.manifest;
  const pathname = options?.pathname;
  const method = options?.method;

  if (
    !Array.isArray(manifest) ||
    typeof pathname !== "string" ||
    pathname.length === 0 ||
    typeof method !== "string" ||
    method.length === 0
  ) {
    throw new TypeError(
      "[Goribu] matchRoute({ manifest, pathname, method }) requires a route manifest, " +
        "a non-empty URL pathname, and an HTTP method.",
    );
  }

  if (!pathname.startsWith("/")) {
    throw new Error(
      `[Goribu] Cannot match route pathname "${pathname}". ` +
        `Pass URL.pathname, which starts with "/", rather than a full URL or relative path.`,
    );
  }

  const pathMatch = matchPath(manifest, pathname);
  if (!pathMatch) return { kind: "not-found" };

  const { route, params } = pathMatch;
  const normalizedMethod = method.toUpperCase();

  // Explicit exports always win, including the HEAD and OPTIONS overrides.
  if (route.methods.includes(normalizedMethod)) {
    return {
      kind: "handler",
      route,
      params,
      method: normalizedMethod,
    };
  }

  // A page without its own GET renders by convention. Returning a distinct kind
  // keeps Block 2 from looking for a handler that intentionally does not exist.
  if (normalizedMethod === "GET" && hasImplicitGet(route)) {
    return { kind: "page", route, params };
  }

  // HEAD uses the effective GET behavior when no explicit HEAD exists. Carrying
  // that exact target keeps dispatch from having to derive the GET rule again.
  if (normalizedMethod === "HEAD" && hasGet(route)) {
    return {
      kind: "automatic-head",
      route,
      params,
      target: route.methods.includes("GET")
        ? { kind: "handler", method: "GET" }
        : { kind: "page" },
    };
  }

  const allowedMethods = getAllowedMethods(route);

  // Every matched path answers OPTIONS automatically unless the route exported
  // its own handler, which was returned above.
  if (normalizedMethod === "OPTIONS") {
    return {
      kind: "automatic-options",
      route,
      params,
      allowedMethods,
    };
  }

  return {
    kind: "method-not-allowed",
    route,
    params,
    allowedMethods,
  };
}

/**
 * Find the first structural path match. Manifest generation has already sorted
 * entries by specificity, so stopping here preserves static-before-dynamic
 * precedence without sorting on every request.
 */
function matchPath(manifest, pathname) {
  const requestSegments = decodePathSegments(normalizePath(pathname));
  if (!requestSegments) return null;

  for (const route of manifest) {
    const params = matchSegments(route.segments, requestSegments);
    if (params) return { route, params };
  }

  return null;
}

/**
 * Treat one trailing slash as equivalent while preserving interior empty
 * segments. This accepts `/posts/` without making `/posts//edit` look valid.
 */
function normalizePath(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function splitPath(pathname) {
  if (pathname === "/") return [];
  return pathname.slice(1).split("/");
}

/**
 * Decode once before comparing so encoded URL.pathname values can match both
 * static source names and dynamic parameters. Splitting first deliberately keeps
 * an encoded slash inside its original segment, where it becomes parameter data.
 */
function decodePathSegments(pathname) {
  try {
    return splitPath(pathname).map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

/**
 * Compare one decoded request path with one route and safely capture dynamic
 * values. defineProperty preserves names such as `__proto__` as ordinary data.
 */
function matchSegments(routeSegments, requestSegments) {
  if (routeSegments.length !== requestSegments.length) return null;

  const params = {};

  for (let index = 0; index < routeSegments.length; index += 1) {
    const routeSegment = routeSegments[index];
    const requestSegment = requestSegments[index];

    if (routeSegment.type === "static") {
      if (routeSegment.value !== requestSegment) return null;
      continue;
    }

    if (requestSegment.length === 0) return null;

    Object.defineProperty(params, routeSegment.name, {
      configurable: true,
      enumerable: true,
      value: requestSegment,
      writable: true,
    });
  }

  return params;
}

function hasImplicitGet(route) {
  return route.hasDefaultExport && !route.methods.includes("GET");
}

function hasGet(route) {
  return route.methods.includes("GET") || hasImplicitGet(route);
}

/**
 * List every method a request may use, not only explicit exports. This single
 * ordered list is ready for both automatic OPTIONS and a 405 Allow header.
 */
function getAllowedMethods(route) {
  return HANDLER_METHODS.filter((method) => {
    if (route.methods.includes(method)) return true;
    if (method === "GET") return hasImplicitGet(route);
    if (method === "HEAD") return hasGet(route);
    if (method === "OPTIONS") return true;
    return false;
  });
}
