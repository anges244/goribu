/**
 * Serialize one explicitly configured outgoing cookie.
 *
 * The serializer validates programming input and adds no policy defaults. Security
 * attributes, path/domain ownership, encoding, signing, and auth behavior remain
 * decisions of the internal subsystem creating the cookie. In particular,
 * SameSite=None does not imply Secure here; a consumer that needs browser acceptance
 * of that combination must explicitly request both attributes.
 */
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;
const COOKIE_PATH = /^[\x20-\x3A\x3C-\x7E]+$/;
const OPTION_NAMES = new Set([
  "domain",
  "path",
  "expires",
  "maxAge",
  "httpOnly",
  "secure",
  "sameSite",
]);
const SAME_SITE = new Map([
  ["lax", "Lax"],
  ["strict", "Strict"],
  ["none", "None"],
]);

/**
 * @param {string} name
 * @param {string} value
 * @param {{
 *   domain?: string,
 *   path?: string,
 *   expires?: Date,
 *   maxAge?: number,
 *   httpOnly?: boolean,
 *   secure?: boolean,
 *   sameSite?: "lax"|"strict"|"none"|"Lax"|"Strict"|"None",
 * }} [options]
 * @returns {string}
 */
export function serializeCookie(name, value, options = {}) {
  assertCookieName(name);
  assertCookieValue(value);
  const attributes = normalizeOptions(options);

  const parts = [`${name}=${value}`];

  if (attributes.domain !== undefined) {
    assertDomain(attributes.domain);
    parts.push(`Domain=${attributes.domain}`);
  }
  if (attributes.path !== undefined) {
    assertPath(attributes.path);
    parts.push(`Path=${attributes.path}`);
  }
  if (attributes.maxAge !== undefined) {
    assertMaxAge(attributes.maxAge);
    parts.push(`Max-Age=${attributes.maxAge}`);
  }
  if (attributes.expires !== undefined) {
    assertExpires(attributes.expires);
    parts.push(`Expires=${attributes.expires.toUTCString()}`);
  }
  if (attributes.httpOnly !== undefined) {
    assertBooleanOption("httpOnly", attributes.httpOnly);
    if (attributes.httpOnly) parts.push("HttpOnly");
  }
  if (attributes.secure !== undefined) {
    assertBooleanOption("secure", attributes.secure);
    if (attributes.secure) parts.push("Secure");
  }
  if (attributes.sameSite !== undefined) {
    const sameSite = resolveSameSite(attributes.sameSite);
    parts.push(`SameSite=${sameSite}`);
  }

  return parts.join("; ");
}

function assertCookieName(name) {
  if (typeof name !== "string" || !COOKIE_NAME.test(name)) {
    throw new TypeError(
      `[Goribu] Invalid outgoing cookie name ${formatValue(name)}. ` +
        "Use a non-empty HTTP token without whitespace or separator characters.",
    );
  }
}

function assertCookieValue(value) {
  if (typeof value !== "string" || !COOKIE_VALUE.test(value)) {
    throw new TypeError(
      `[Goribu] Invalid outgoing cookie value for serializeCookie(): ${formatValue(value)}. ` +
        "Pass an ASCII cookie value without whitespace, quotes, commas, semicolons, backslashes, or control characters. " +
        "Encode structured or Unicode data before setting the cookie.",
    );
  }
}

function normalizeOptions(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      "[Goribu] serializeCookie(name, value, options) requires options to be a plain object. " +
        "Pass only explicitly requested cookie attributes, or omit options.",
    );
  }

  const normalized = Object.create(null);
  for (const name of Reflect.ownKeys(options)) {
    if (typeof name !== "string" || !OPTION_NAMES.has(name)) {
      throw new TypeError(
        `[Goribu] Unsupported cookie option ${formatValue(name)}. ` +
          "Use only domain, path, expires, maxAge, httpOnly, secure, or sameSite.",
      );
    }
    normalized[name] = options[name];
  }

  return normalized;
}

function assertDomain(domain) {
  if (typeof domain !== "string") {
    throw invalidDomainError(domain);
  }

  const value = domain.startsWith(".") ? domain.slice(1) : domain;
  const labels = value.split(".");
  const valid =
    domain.length <= 254 &&
    value.length > 0 &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
    );

  if (!valid) throw invalidDomainError(domain);
}

function invalidDomainError(domain) {
  return new TypeError(
    `[Goribu] Invalid cookie domain ${formatValue(domain)}. ` +
      "Pass a hostname such as example.com or .example.com without a scheme, port, path, or whitespace.",
  );
}

function assertPath(path) {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    !COOKIE_PATH.test(path)
  ) {
    throw new TypeError(
      `[Goribu] Invalid cookie path ${formatValue(path)}. ` +
        'Pass an absolute path beginning with "/" and containing no control characters or semicolons.',
    );
  }
}

function assertExpires(expires) {
  const year = expires instanceof Date ? expires.getUTCFullYear() : Number.NaN;
  if (
    !(expires instanceof Date) ||
    Number.isNaN(expires.getTime()) ||
    year < 1601 ||
    year > 9999
  ) {
    throw new TypeError(
      `[Goribu] Invalid cookie expires value ${formatValue(expires)}. ` +
        "Pass a valid Date whose UTC year is from 1601 through 9999.",
    );
  }
}

function assertMaxAge(maxAge) {
  if (!Number.isInteger(maxAge) || maxAge < 0) {
    throw new TypeError(
      `[Goribu] Invalid cookie maxAge value ${formatValue(maxAge)}. ` +
        "Pass a non-negative integer number of seconds.",
    );
  }
}

function assertBooleanOption(name, value) {
  if (typeof value !== "boolean") {
    throw new TypeError(
      `[Goribu] Invalid cookie ${name} value ${formatValue(value)}. ` +
        `Pass true to include ${name}, false to omit it, or leave the option undefined.`,
    );
  }
}

function resolveSameSite(value) {
  const resolved =
    typeof value === "string" ? SAME_SITE.get(value.toLowerCase()) : undefined;
  if (!resolved) {
    throw new TypeError(
      `[Goribu] Invalid cookie sameSite value ${formatValue(value)}. ` +
        'Use "Lax", "Strict", or "None", or omit the option.',
    );
  }
  return resolved;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function formatValue(value) {
  try {
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "symbol") return value.toString();
    if (value instanceof Date) return `Date(${value.toString()})`;
    return String(value);
  } catch {
    return typeof value;
  }
}
