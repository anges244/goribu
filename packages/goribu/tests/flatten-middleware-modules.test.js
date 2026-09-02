import { describe, expect, it } from "vitest";
import { flattenMiddlewareModules } from "../src/runtime/flatten-middleware-modules.js";

describe("flattenMiddlewareModules", () => {
  it("preserves outer module order and left-to-right array order", () => {
    function root() {}
    function requireUser() {}
    function audit() {}

    const rootBinding = binding("_middleware.js", { default: root });
    const adminExport = Object.freeze([requireUser, audit]);
    const adminBinding = binding("admin/_middleware.js", {
      default: adminExport,
    });
    const bindings = Object.freeze([rootBinding, adminBinding]);

    const middleware = flattenMiddlewareModules(bindings);

    expect(middleware).toEqual([root, requireUser, audit]);
    expect(middleware[0]).toBe(root);
    expect(middleware[1]).toBe(requireUser);
    expect(middleware[2]).toBe(audit);
    expect(adminBinding.module.default).toBe(adminExport);
  });

  it("keeps an empty binding list empty", () => {
    expect(flattenMiddlewareModules([])).toEqual([]);
  });

  it("fails closed on malformed bindings and invalid default exports", () => {
    function valid() {}

    expect(() => flattenMiddlewareModules()).toThrow(
      "[Goribu] flattenMiddlewareModules(bindings) requires the ordered bindings returned by bindMiddlewareModules()",
    );
    expect(() => flattenMiddlewareModules([{}])).toThrow(
      "[Goribu] Middleware module binding at index 0 is invalid. Pass the array returned by bindMiddlewareModules() without changing it",
    );
    expect(() =>
      flattenMiddlewareModules([binding("_middleware.js", {})]),
    ).toThrow(
      '[Goribu] Middleware module "_middleware.js" must default-export a middleware function or a flat array of middleware functions',
    );
    expect(() =>
      flattenMiddlewareModules([
        binding("admin/_middleware.js", { default: [valid, "not middleware"] }),
      ]),
    ).toThrow(
      '[Goribu] Middleware module "admin/_middleware.js" has a non-function default export at array index 1. Export only middleware functions in one flat array',
    );
    expect(() =>
      flattenMiddlewareModules([
        binding("admin/_middleware.js", { default: [[valid]] }),
      ]),
    ).toThrow(
      '[Goribu] Middleware module "admin/_middleware.js" has a non-function default export at array index 0',
    );
  });
});

function binding(relativePath, module) {
  return Object.freeze({
    source: Object.freeze({
      filePath: `/app/src/routes/${relativePath}`,
      relativePath,
    }),
    module: Object.freeze(module),
  });
}
