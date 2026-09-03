import {
  PROTOCOL_REPRESENTATION_HEADERS,
  isProtocolResponse,
} from "./protocol-response.js";

const UNSAFE_GLOBAL_HEADER_NAMES = new Set([
  "content-length",
  "content-range",
  "content-encoding",
  "content-type",
  "location",
  "set-cookie",
  "trailer",
  "transfer-encoding",
]);

/**
 * Assert that an optional global response-header policy is callback-shaped.
 *
 * @param {unknown} value
 * @param {string} caller
 * @returns {undefined|Function}
 */
export function assertOptionalResponseHeaders(value, caller) {
  if (value === undefined || typeof value === "function") return value;

  throw new TypeError(
    `[Goribu] ${caller} must be a responseHeaders callback when provided. ` +
      "Use ({ request, env, mode, nonce }) => ({ \"header-name\": \"value\" }); static header objects are not accepted.",
  );
}

/** Create a cryptographically random nonce safe for CSP headers and URLs. */
export function createResponseNonce() {
  const getRandomValues = globalThis.crypto?.getRandomValues;
  if (typeof getRandomValues !== "function") {
    throw new Error(
      "[Goribu] createResponseNonce() requires crypto.getRandomValues(). " +
        "Run Goribu in a Web Crypto-capable Worker runtime.",
    );
  }

  const bytes = new Uint8Array(16);
  try {
    getRandomValues.call(globalThis.crypto, bytes);
  } catch (cause) {
    throw new Error(
      "[Goribu] createResponseNonce() could not obtain secure random values from crypto.getRandomValues(). " +
        "Run Goribu in a Web Crypto-capable Worker runtime.",
      { cause },
    );
  }

  let nonce = "";
  for (const byte of bytes) nonce += byte.toString(16).padStart(2, "0");
  return nonce;
}

/**
 * Resolve one request's synchronous global response-header policy.
 *
 * @param {{
 *   responseHeaders?: Function,
 *   request: Request,
 *   env: unknown,
 *   mode: unknown,
 *   nonce: string,
 * }} options
 * @returns {Headers}
 */
export function resolveGlobalResponseHeaders(options) {
  const responseHeaders = assertOptionalResponseHeaders(
    options?.responseHeaders,
    "responseHeaders",
  );
  if (responseHeaders === undefined) return new Headers();

  const result = responseHeaders(
    Object.freeze({
      request: options?.request,
      env: options?.env,
      mode: options?.mode,
      nonce: options?.nonce,
    }),
  );

  if (isThenable(result)) {
    throw new TypeError(
      "[Goribu] responseHeaders must return headers synchronously; Promises and thenables are not supported. " +
        "Return a plain object directly and move asynchronous work before response handling.",
    );
  }
  if (!isPlainObject(result)) {
    throw new TypeError(
      "[Goribu] responseHeaders must return a plain object whose values are strings or arrays of strings. " +
        "Return headers such as { \"content-security-policy\": \"default-src 'self'\" }.",
    );
  }

  const normalized = new Headers();
  for (const name of Object.keys(result)) {
    const value = result[name];
    if (
      typeof value !== "string" &&
      (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    ) {
      throw new TypeError(
        `[Goribu] Global response header "${name}" must be a string or an array of strings. ` +
          "Convert numbers and other values to strings in responseHeaders.",
      );
    }

    if (UNSAFE_GLOBAL_HEADER_NAMES.has(name.toLowerCase())) {
      throw new TypeError(
        `[Goribu] responseHeaders cannot set unsafe blanket header "${name}". ` +
          "Set it on the response that owns the body, redirect, cookies, or transport metadata instead.",
      );
    }

    appendValidatedHeader(normalized, name, value);
  }

  return normalized;
}

/**
 * Apply global headers as defaults without consuming the response body.
 *
 * Existing response headers win. Vary is the sole exception: its tokens are
 * merged case-insensitively, while a wildcard on either side wins outright.
 *
 * @param {Response} response
 * @param {Headers|Readonly<Record<string, string|readonly string[]>>} globalHeaders
 * @returns {Response}
 */
export function applyGlobalResponseHeaders(response, globalHeaders) {
  if (!(response instanceof Response)) {
    throw new TypeError(
      "[Goribu] applyGlobalResponseHeaders(response, globalHeaders) requires a Web Response. " +
        "Pass the response produced by dispatch or error handling.",
    );
  }

  const defaults = normalizeInternalHeaders(globalHeaders);
  if ([...defaults].length === 0) return response;

  const headers = new Headers(response.headers);
  const protectedRepresentationHeaders = isProtocolResponse(response)
    ? new Set(PROTOCOL_REPRESENTATION_HEADERS)
    : null;
  let changed = false;

  for (const [name, value] of defaults) {
    if (protectedRepresentationHeaders?.has(name)) continue;
    if (name === "vary") {
      const vary = mergeVary(headers.has(name) ? headers.get(name) : null, value);
      if (vary.changed) {
        headers.set(name, vary.value);
        changed = true;
      }
      continue;
    }

    if (!headers.has(name)) {
      headers.set(name, value);
      changed = true;
    }
  }

  if (!changed) return response;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function appendValidatedHeader(target, name, value) {
  try {
    const validator = new Headers();
    validator.set(name, "");
    const normalizedName = [...validator.keys()][0];
    const values = Array.isArray(value) ? value : [value];

    if (values.length === 0) {
      target.set(normalizedName, "");
      return;
    }
    for (const item of values) target.append(normalizedName, item);
  } catch (cause) {
    throw new TypeError(
      `[Goribu] Invalid global response header "${name}". ` +
        "Use a valid HTTP header name and values without line breaks.",
      { cause },
    );
  }
}

function normalizeInternalHeaders(value) {
  if (value instanceof Headers) return value;
  if (!isPlainObject(value)) {
    throw new TypeError(
      "[Goribu] applyGlobalResponseHeaders(response, globalHeaders) requires normalized Headers or immutable header data.",
    );
  }

  const normalized = new Headers();
  for (const name of Object.keys(value)) {
    appendValidatedHeader(normalized, name, value[name]);
  }
  return normalized;
}

function mergeVary(existingValue, globalValue) {
  const existingTokens = varyTokens(existingValue);
  const globalTokens = varyTokens(globalValue);
  const existingHasWildcard = existingTokens.some((token) => token === "*");
  const globalHasWildcard = globalTokens.some((token) => token === "*");

  if (existingHasWildcard || globalHasWildcard) {
    return {
      changed: existingValue !== "*",
      value: "*",
    };
  }

  if (existingValue === null) {
    return {
      changed: true,
      value: uniqueVaryTokens(globalTokens).join(", "),
    };
  }

  const seen = new Set(existingTokens.map((token) => token.toLowerCase()));
  const merged = [...existingTokens];
  let changed = false;
  for (const token of globalTokens) {
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(token);
    changed = true;
  }

  return { changed, value: merged.join(", ") };
}

function varyTokens(value) {
  if (value === null) return [];
  return value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function uniqueVaryTokens(tokens) {
  const seen = new Set();
  return tokens.filter((token) => {
    const key = token.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isThenable(value) {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }

  try {
    return typeof value.then === "function";
  } catch (cause) {
    throw new TypeError(
      "[Goribu] responseHeaders must return headers synchronously; its returned thenable could not be inspected. " +
        "Return a plain header object directly.",
      { cause },
    );
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
