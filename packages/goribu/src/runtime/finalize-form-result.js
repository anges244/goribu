import { FORM_MEDIA_TYPE } from "../forms/form-protocol.js";
import { isResponseResult } from "./create-response.js";
import { markProtocolResponse } from "./protocol-response.js";

const BODYLESS_STATUSES = new Set([204, 205, 304]);
const FORM_RESULT_KINDS = new Set(["json", "invalid", "redirect", "render"]);
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

/** Return whether a route result has a negotiated Form envelope representation. */
export function isFormResponseResult(result) {
  return isResponseResult(result) && FORM_RESULT_KINDS.has(result.kind);
}

/** Serialize one route result for an enhanced Form request. */
export function finalizeFormResult(result, options) {
  if (!isFormResponseResult(result)) {
    throw new TypeError(
      "[Goribu] finalizeFormResult(result, { routeId }) requires a genuine res.json(), res.invalid(), res.redirect(), or res.render() result.",
    );
  }

  if (result.kind !== "redirect" && BODYLESS_STATUSES.has(result.status)) {
    throw new RangeError(
      `[Goribu] Cannot send a ${result.kind} form envelope with status ${result.status} because that status cannot carry a response body. Choose a body-bearing status before returning the response.`,
    );
  }

  let payload;
  if (result.kind === "json") {
    payload = { type: "json", data: JSON.parse(result.body) };
  } else if (result.kind === "invalid") {
    payload = { type: "invalid", errors: JSON.parse(result.body).errors };
  } else if (result.kind === "redirect") {
    payload = { type: "redirect", to: result.location };
  } else {
    const routeId = options?.routeId;
    if (typeof routeId !== "string" || routeId.length === 0) {
      throw new TypeError(
        "[Goribu] Cannot finalize a form render without the matched route ID. Pass the canonical match.route.id from Goribu's generated manifest.",
      );
    }
    payload = {
      type: "render",
      route: routeId,
      props: result.props,
      meta: options?.metadata,
    };
  }

  const headers = createWebHeaders(result.headers);
  for (const name of REPRESENTATION_HEADERS) headers.delete(name);
  headers.set("cache-control", "no-store");
  headers.set("content-type", FORM_MEDIA_TYPE);
  mergeVaryAccept(headers);

  return markProtocolResponse(
    new Response(JSON.stringify(payload), {
      status: result.status,
      headers,
    }),
  );
}

export function mergeVaryAccept(headers) {
  const vary = headers.get("vary");
  if (vary === null || vary.trim().length === 0) {
    headers.set("vary", "Accept");
    return;
  }

  const fields = vary.split(",").map((field) => field.trim());
  if (
    fields.includes("*") ||
    fields.some((field) => field.toLowerCase() === "accept")
  ) {
    return;
  }

  headers.set("vary", `${vary}, Accept`);
}

function createWebHeaders(values) {
  const headers = new Headers();

  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }

  return headers;
}
