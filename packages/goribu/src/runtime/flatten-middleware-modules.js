/**
 * Validate and flatten ordered middleware module bindings into one function chain.
 *
 * Bound modules remain outermost-first. A module may contribute one default-
 * exported function or one flat array, whose functions retain left-to-right
 * order. This helper does not execute or compose the resulting middleware.
 *
 * @param {Array<{
 *   source: { filePath: string, relativePath: string },
 *   module: object,
 * }>} bindings
 * @returns {Function[]}
 */
export function flattenMiddlewareModules(bindings) {
  if (!Array.isArray(bindings)) {
    throw new TypeError(
      "[Goribu] flattenMiddlewareModules(bindings) requires the ordered bindings returned by bindMiddlewareModules(). Pass [] when no middleware applies.",
    );
  }

  const middleware = [];

  for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
    const binding = bindings[bindingIndex];
    assertBinding(binding, bindingIndex);

    const exported = binding.module.default;
    if (typeof exported === "function") {
      middleware.push(exported);
      continue;
    }

    if (Array.isArray(exported)) {
      for (let exportIndex = 0; exportIndex < exported.length; exportIndex += 1) {
        const middlewareFunction = exported[exportIndex];
        if (typeof middlewareFunction !== "function") {
          throw new TypeError(
            `[Goribu] Middleware module ${formatSource(binding.source)} has a non-function ` +
              `default export at array index ${exportIndex}. Export only middleware functions in one flat array.`,
          );
        }
        middleware.push(middlewareFunction);
      }
      continue;
    }

    throw new TypeError(
      `[Goribu] Middleware module ${formatSource(binding.source)} must default-export a middleware function ` +
        "or a flat array of middleware functions. Add a valid default export to the _middleware file.",
    );
  }

  return middleware;
}

function assertBinding(binding, index) {
  if (
    binding !== null &&
    typeof binding === "object" &&
    binding.source !== null &&
    typeof binding.source === "object" &&
    typeof binding.source.filePath === "string" &&
    binding.source.filePath.length > 0 &&
    typeof binding.source.relativePath === "string" &&
    binding.source.relativePath.length > 0 &&
    binding.module !== null &&
    typeof binding.module === "object"
  ) {
    return;
  }

  throw new TypeError(
    `[Goribu] Middleware module binding at index ${index} is invalid. ` +
      "Pass the array returned by bindMiddlewareModules() without changing it.",
  );
}

function formatSource(source) {
  return JSON.stringify(source.relativePath);
}
