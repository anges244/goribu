/**
 * Prepare and run Goribu's pre-handler middleware chain.
 *
 * The caller supplies middleware in resolved outermost-to-innermost order.
 * Each `(req, res)` function returns `undefined` to continue or a genuine
 * response intent to stop. Route loading, folder ordering, handler invocation,
 * and error-page handling remain responsibilities of later dispatch code.
 */
import { isResponseResult } from "./create-response.js";

/**
 * Snapshot an already ordered middleware list and return its reusable runner.
 *
 * @param {Function[]} middleware
 * @returns {(request: object, response: object) => Promise<object|undefined>}
 */
export function composeMiddleware(middleware) {
  if (!Array.isArray(middleware)) {
    throw new TypeError(
      "[Goribu] composeMiddleware(middleware) requires an ordered array of middleware functions. " +
        "Pass [] when no middleware applies to the matched route.",
    );
  }

  const chain = [...middleware];
  for (let index = 0; index < chain.length; index += 1) {
    if (typeof chain[index] !== "function") {
      throw new TypeError(
        `[Goribu] Middleware at index ${index} is not a function. ` +
          "Export a middleware function or an array of functions from the route's _middleware file.",
      );
    }
  }

  return async function runMiddleware(request, response) {
    for (let index = 0; index < chain.length; index += 1) {
      const middlewareFunction = chain[index];
      const result = await middlewareFunction(request, response);

      if (result === undefined) continue;
      if (isResponseResult(result)) return result;

      const identity = middlewareFunction.name
        ? `Middleware "${middlewareFunction.name}" at index ${index}`
        : `Middleware at index ${index}`;
      if (result instanceof Response) {
        throw new TypeError(
          `[Goribu] ${identity} returned a Web Response. ` +
            "Return a res.* result instead so Goribu can apply cookies and other framework behavior. " +
            "Use res.text(), res.json(), res.invalid(), res.redirect(), res.render(), or res.notFound().",
        );
      }

      throw new TypeError(
        `[Goribu] ${identity} returned a non-response value. ` +
          "Return nothing to continue, or return a res.* result such as res.redirect('/login') to stop the chain.",
      );
    }

    return undefined;
  };
}
