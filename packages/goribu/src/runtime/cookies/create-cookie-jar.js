/**
 * Hold incoming and pending outgoing cookies for one Worker request.
 *
 * The jar parses eagerly, exposes no route API, and applies no namespace or auth
 * policy. It only records explicit set/delete operations for the future application
 * boundary to pass to appendSetCookies() after success or error handling.
 */
import { parseCookie } from "./parse-cookie.js";
import { serializeCookie } from "./serialize-cookie.js";

const DELETE_EXPIRES = new Date(0);
const DELETE_OPTION_NAMES = new Set(["domain", "path"]);

/**
 * @param {Request} request
 * @returns {{
 *   get(name: string): string|null,
 *   set(name: string, value: string, options?: object): void,
 *   delete(name: string, options?: { domain?: string, path?: string }): void,
 *   readonly pending: readonly string[],
 * }}
 */
export function createCookieJar(request) {
  if (!(request instanceof Request)) {
    throw new TypeError(
      "[Goribu] createCookieJar(request) requires a Web Request. " +
        "Pass the Request received by the Worker fetch handler.",
    );
  }

  const incoming = parseCookie(request.headers.get("cookie"));
  const pending = [];

  return Object.freeze({
    get(name) {
      if (typeof name !== "string" || name.length === 0) {
        throw new TypeError(
          "[Goribu] cookies.get(name) requires a non-empty cookie name string. " +
            "Pass the exact name of the incoming cookie to read.",
        );
      }
      return incoming.get(name) ?? null;
    },

    set(name, value, options) {
      pending.push(serializeCookie(name, value, options));
    },

    delete(name, options) {
      const matching = assertDeleteOptions(options);
      pending.push(
        serializeCookie(name, "", {
          ...matching,
          maxAge: 0,
          expires: DELETE_EXPIRES,
        }),
      );
    },

    get pending() {
      return Object.freeze([...pending]);
    },
  });
}

function assertDeleteOptions(options) {
  if (options === undefined) return {};
  if (!isPlainObject(options)) {
    throw new TypeError(
      "[Goribu] cookies.delete(name, options) requires options to be a plain object. " +
        "Pass the path and domain that identify the cookie being removed, or omit options.",
    );
  }

  for (const name of Reflect.ownKeys(options)) {
    if (typeof name !== "string" || !DELETE_OPTION_NAMES.has(name)) {
      throw new TypeError(
        `[Goribu] cookies.delete(name, options) does not support option ${formatValue(name)}. ` +
          "Deletion accepts only the matching path and domain; expiry is managed automatically.",
      );
    }
  }

  return options;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function formatValue(value) {
  return typeof value === "symbol" ? value.toString() : JSON.stringify(value);
}
