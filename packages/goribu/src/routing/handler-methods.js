// These are the function names a route file may export to handle HTTP requests.
// Keeping one official list means the analyzer, generated manifest, and runtime
// cannot accidentally disagree about which methods Goribu supports. Explicit
// HEAD and OPTIONS exports are allowed overrides; the matcher supplies automatic
// behavior for either method only when the route does not export it.
export const HANDLER_METHODS = Object.freeze([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

// A Set answers membership questions directly: `has("GET")` is true while
// `has("get")` and `has("meta")` are false. It is kept private so callers use
// the function below instead of depending on the storage choice.
const HANDLER_METHOD_SET = new Set(HANDLER_METHODS);

/**
 * Return true when a name is one of Goribu's supported HTTP handlers.
 *
 * For example, route analysis calls this for every exported name it finds.
 */
export function isHandlerMethod(name) {
  return HANDLER_METHOD_SET.has(name);
}
