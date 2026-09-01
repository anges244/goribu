/**
 * Parse one incoming Cookie header into deterministic, opaque values.
 *
 * This is intentionally forgiving because request headers are untrusted input:
 * malformed entries are ignored, values are not decoded, and the first value for
 * a repeated name wins. Outgoing validation belongs to serializeCookie().
 */
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * @param {string|null|undefined} header
 * @returns {Map<string, string>}
 */
export function parseCookie(header) {
  if (header === null || header === undefined || header === "") {
    return new Map();
  }
  if (typeof header !== "string") {
    throw new TypeError(
      "[Goribu] parseCookie(header) requires a Cookie header string, null, or undefined. " +
        "Pass request.headers.get('cookie') without changing its value.",
    );
  }

  const cookies = new Map();

  for (const entry of header.split(";")) {
    const equalsIndex = entry.indexOf("=");
    if (equalsIndex === -1) continue;

    const name = entry.slice(0, equalsIndex).trim();
    if (!COOKIE_NAME.test(name) || cookies.has(name)) continue;

    const value = entry.slice(equalsIndex + 1).trim();
    cookies.set(name, value);
  }

  return cookies;
}
