export const PROTOCOL_REPRESENTATION_HEADERS = Object.freeze([
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

const protocolResponses = new WeakSet();

/** Mark an internal negotiated response whose representation headers are framework-owned. */
export function markProtocolResponse(response) {
  protocolResponses.add(response);
  return response;
}

/** Return whether Goribu owns the response's negotiated representation invariants. */
export function isProtocolResponse(response) {
  return protocolResponses.has(response);
}

/** Preserve the internal marker when transport processing reconstructs a response. */
export function copyProtocolResponseMark(source, target) {
  if (isProtocolResponse(source)) markProtocolResponse(target);
  return target;
}
