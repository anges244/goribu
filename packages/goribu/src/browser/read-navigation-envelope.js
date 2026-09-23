import { normalizeRouteMeta } from "../metadata/route-meta.js";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Parse and validate the reserved Worker's kind-tagged navigation response. */
export async function readNavigationEnvelope(response, options = {}) {
  if (!(response instanceof Response)) {
    throw new TypeError(
      "[Goribu] Cannot read a navigation envelope because fetch did not return a Web Response.",
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new TypeError(
      `[Goribu] Navigation endpoint returned ${JSON.stringify(contentType || "no Content-Type")} instead of application/json. Perform a full page load because the Worker did not return Goribu's navigation protocol.`,
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new SyntaxError(
      "[Goribu] Navigation endpoint returned malformed JSON. Perform a full page load and check the Worker logs for the failed request.",
      { cause },
    );
  }
  if (!isPlainObject(payload) || typeof payload.kind !== "string") {
    throw invalidEnvelope("a kind-tagged object");
  }
  if (options.buildId !== undefined && payload.buildId !== options.buildId) {
    throw invalidEnvelope("static data from the current browser build");
  }

  if (payload.kind === "render") {
    if (
      typeof payload.routeId !== "string" ||
      payload.routeId.length === 0 ||
      !isPlainObject(payload.props) ||
      !Object.hasOwn(payload, "meta") ||
      !isHttpStatus(payload.status)
    ) {
      throw invalidEnvelope(
        'render data shaped as { kind: "render", routeId, props, meta, status }',
      );
    }
    return Object.freeze({
      kind: "render",
      routeId: payload.routeId,
      props: payload.props,
      meta: normalizeRouteMeta(payload.meta, {
        source: "Navigation render metadata",
      }),
      status: payload.status,
    });
  }

  if (payload.kind === "redirect") {
    if (
      typeof payload.location !== "string" ||
      payload.location.length === 0 ||
      !REDIRECT_STATUSES.has(payload.status)
    ) {
      throw invalidEnvelope(
        'redirect data shaped as { kind: "redirect", location, status }',
      );
    }
    return Object.freeze({
      kind: "redirect",
      location: payload.location,
      status: payload.status,
    });
  }

  if (payload.kind === "reload") {
    return Object.freeze({ kind: "reload" });
  }

  throw invalidEnvelope('kind "render", "redirect", or "reload"');
}

function invalidEnvelope(expectation) {
  return new TypeError(
    `[Goribu] Navigation endpoint returned an invalid envelope; expected ${expectation}. Rebuild the Worker and client together so they use the same protocol.`,
  );
}

function isHttpStatus(value) {
  return Number.isInteger(value) && value >= 200 && value <= 599;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
