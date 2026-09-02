
export const NAVIGATION_PATH = "/_goribu/worker-nav";

/**
 * Classify one Worker request as an ordinary document request, a valid
 * navigation endpoint request, or an immediate framework response.
 *
 * Navigation accepts only a root-relative, non-framework target. The target is
 * dispatched as a same-origin GET with the original request headers so routes
 * observe the same cookies and request context as a full page load.
 *
 * @param {Request} request
 * @returns {{ kind: "document"|"navigation", request: Request }|{ kind: "response", response: Response }}
 */
export function resolveNavigationRequest(request) {
  if (!(request instanceof Request)) {
    throw new TypeError(
      "[Goribu] resolveNavigationRequest(request) requires a Web Request. Pass the Request received by the Worker fetch handler.",
    );
  }

  const endpointUrl = new URL(request.url);
  if (endpointUrl.pathname !== NAVIGATION_PATH) {
    return Object.freeze({ kind: "document", request });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return navigationError(
      405,
      `[Goribu] ${request.method} is not supported on ${NAVIGATION_PATH}. Request the endpoint with GET; submit forms to their real route URL.`,
      { allow: "GET, HEAD" },
    );
  }

  const target = endpointUrl.searchParams.get("to");
  if (target === null || target.length === 0) {
    return navigationError(
      400,
      `[Goribu] ${NAVIGATION_PATH} requires a non-empty "to" query parameter. Request ${NAVIGATION_PATH}?to=%2Ftarget-path.`,
    );
  }
  if (!target.startsWith("/") || target.startsWith("//")) {
    return navigationError(
      400,
      `[Goribu] ${NAVIGATION_PATH} accepts only a root-relative "to" path on this application. Pass a value such as "/posts/42", not ${JSON.stringify(target)}.`,
    );
  }

  let targetUrl;
  try {
    targetUrl = new URL(target, endpointUrl.origin);
  } catch {
    return navigationError(
      400,
      `[Goribu] ${NAVIGATION_PATH} received an invalid "to" path. Pass a root-relative URL such as "/posts/42".`,
    );
  }
  if (targetUrl.origin !== endpointUrl.origin) {
    return navigationError(
      400,
      `[Goribu] ${NAVIGATION_PATH} cannot navigate to another origin. Pass a root-relative path on ${JSON.stringify(endpointUrl.origin)}.`,
    );
  }
  if (targetUrl.pathname.startsWith("/_goribu/")) {
    return navigationError(
      400,
      `[Goribu] ${NAVIGATION_PATH} cannot navigate to reserved framework path ${JSON.stringify(targetUrl.pathname)}. Pass an application route outside /_goribu/.`,
    );
  }

  targetUrl.hash = "";
  const headers = new Headers(request.headers);
  headers.delete("content-length");

  return Object.freeze({
    kind: "navigation",
    request: new Request(targetUrl, {
      method: "GET",
      headers,
      signal: request.signal,
    }),
  });
}

function navigationError(status, message, extraHeaders = undefined) {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");

  return Object.freeze({
    kind: "response",
    response: new Response(JSON.stringify({ error: message }), { status, headers }),
  });
}
