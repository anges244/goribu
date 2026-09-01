/**
 * Append pending cookies to the final Web Response without buffering its body.
 *
 * The future application boundary calls this once after dispatch or error handling.
 * Existing application Set-Cookie values are copied first, framework values are
 * appended separately, and the original Response is returned only when no work is
 * pending. This module owns transport, not cookie naming or security policy.
 */

/**
 * @param {Response} response
 * @param {readonly string[]} cookieStrings
 * @returns {Response}
 */
export function appendSetCookies(response, cookieStrings) {
  if (!(response instanceof Response)) {
    throw new TypeError(
      "[Goribu] appendSetCookies(response, cookieStrings) requires a Web Response. " +
        "Pass the final response produced by dispatch or the application error boundary.",
    );
  }
  if (!Array.isArray(cookieStrings)) {
    throw new TypeError(
      "[Goribu] appendSetCookies(response, cookieStrings) requires an array of serialized cookies. " +
        "Pass the pending snapshot from the request's internal cookie jar.",
    );
  }

  for (let index = 0; index < cookieStrings.length; index += 1) {
    const cookie = cookieStrings[index];
    if (
      typeof cookie !== "string" ||
      cookie.length === 0 ||
      cookie.includes("\r") ||
      cookie.includes("\n")
    ) {
      throw new TypeError(
        `[Goribu] Pending Set-Cookie value at index ${index} is invalid. ` +
          "Pass non-empty serialized cookie strings without line breaks.",
      );
    }
  }

  if (cookieStrings.length === 0) return response;
  if (response.bodyUsed) {
    throw new TypeError(
      "[Goribu] Cannot append pending cookies because the final Web Response body was already consumed. " +
        "Flush cookies at the application boundary before reading or returning the response body.",
    );
  }

  let headers;
  try {
    headers = new Headers(response.headers);
    for (const cookie of cookieStrings) {
      headers.append("set-cookie", cookie);
    }
  } catch (cause) {
    throw new TypeError(
      "[Goribu] Could not append pending Set-Cookie headers. " +
        "Use serializeCookie() to create valid outgoing cookie strings.",
      { cause },
    );
  }

  try {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (cause) {
    throw new TypeError(
      "[Goribu] Could not rebuild the final Web Response while appending cookies. " +
        "Flush cookies before the response body stream is read, locked, or otherwise disturbed.",
      { cause },
    );
  }
}
