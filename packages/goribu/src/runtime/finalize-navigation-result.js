import { isResponseResult } from "./create-response.js";
import { markProtocolResponse } from "./protocol-response.js";
const BODYLESS_STATUSES = new Set([204, 205, 304]);
const REPRESENTATION_HEADERS = Object.freeze([
  "accept-ranges",
  "cdn-cache-control",
  "cloudflare-cdn-cache-control",
  "content-digest",
  "content-disposition",
  "content-encoding",
  "content-length",
  "content-location",
  "content-range",
  "digest",
  "etag",
  "expires",
  "last-modified",
  "location",
  "repr-digest",
  "surrogate-control",
  "trailer",
  "transfer-encoding",
]);

/**
 * Serialize one genuine route result for the reserved client-navigation endpoint.
 *
 * Page renders carry the canonical route ID and props the browser needs to load
 * and render the page. Redirects become explicit directives so fetch never
 * follows them implicitly. Every other terminal result asks the browser to do a
 * full load, preserving ordinary endpoint and error-page behavior.
 *
 * @param {object} result
 * @param {{ routeId: string }} options
 * @returns {Response}
 */
export function finalizeNavigationResult(result, options) {
  if (!isResponseResult(result)) {
    throw new TypeError(
      "[Goribu] finalizeNavigationResult(result, { routeId }) requires a genuine result returned by a res.* terminal helper.",
    );
  }

  if (result.kind === "render") {
    if (BODYLESS_STATUSES.has(result.status)) {
      throw new RangeError(
        `[Goribu] Cannot render a navigation payload with status ${result.status} because that status cannot carry a response body. Choose a body-bearing status before calling res.render(props).`,
      );
    }
    const routeId = options?.routeId;
    if (typeof routeId !== "string" || routeId.length === 0) {
      throw new TypeError(
        "[Goribu] Cannot finalize a navigation render without the matched route ID. Pass the canonical route.id from Goribu's generated manifest.",
      );
    }

    return navigationJson(
      {
        kind: "render",
        routeId,
        props: result.props,
        meta: options?.metadata,
        status: result.status,
      },
      result.status,
      result.headers,
    );
  }

  if (result.kind === "redirect") {
    return navigationJson(
      {
        kind: "redirect",
        location: result.location,
        status: result.status,
      },
      200,
      result.headers,
    );
  }

  if (
    result.kind === "text" ||
    result.kind === "json" ||
    result.kind === "invalid"
  ) {
    if (BODYLESS_STATUSES.has(result.status)) {
      throw new RangeError(
        `[Goribu] Cannot send a ${result.kind} response with status ${result.status} because that status cannot carry a response body. Choose a body-bearing status before calling the terminal response helper.`,
      );
    }
    return createNavigationReloadResponse(result.headers);
  }

  if (result.kind === "not-found") {
    return createNavigationReloadResponse(result.headers);
  }

  throw new TypeError(
    `[Goribu] Cannot finalize unknown navigation result kind ${JSON.stringify(result.kind)}. Return a supported res.* terminal result without changing it.`,
  );
}

/** Return the explicit full-load directive used for non-page navigation targets. */
export function createNavigationReloadResponse(headers = undefined) {
  return navigationJson({ kind: "reload" }, 200, headers);
}

function navigationJson(payload, status, values) {
  const headers = createWebHeaders(values);
  for (const name of REPRESENTATION_HEADERS) headers.delete(name);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");

  return markProtocolResponse(
    new Response(JSON.stringify(payload), { status, headers }),
  );
}

function createWebHeaders(values) {
  const headers = new Headers();
  if (values === undefined) return headers;

  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}
