import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { selectRouteMiddleware } from "../src/routing/select-route-middleware.js";

const routesDir = join("project", "src", "routes");

describe("selectRouteMiddleware", () => {
  it("selects route-directory ancestors and orders them outermost-first", () => {
    const root = record("_middleware.js");
    const admin = record("admin/_middleware.ts");
    const posts = record("admin/posts/_middleware.jsx");
    const sibling = record("admin/post/_middleware.js");
    const descendant = record("admin/posts/drafts/_middleware.js");
    const middleware = Object.freeze([
      descendant,
      posts,
      sibling,
      root,
      admin,
    ]);

    const selected = selectRouteMiddleware({
      route: {
        id: "src/routes/admin/posts/[id].js",
        filePath: join(routesDir, "admin/posts/[id].js"),
      },
      middleware,
    });

    expect(selected).toEqual([root, admin, posts]);
    expect(middleware).toEqual([descendant, posts, sibling, root, admin]);
  });

  it("limits a root route to root-scoped middleware", () => {
    const root = record("_middleware.js");

    expect(
      selectRouteMiddleware({
        route: {
          id: "src/routes/index.jsx",
          filePath: join(routesDir, "index.jsx"),
        },
        middleware: [record("admin/_middleware.js"), root],
      }),
    ).toEqual([root]);
  });

  it("fails closed on malformed internal inputs", () => {
    expect(() => selectRouteMiddleware()).toThrow(
      "[Goribu] selectRouteMiddleware({ route, middleware }) requires a manifest route",
    );
    expect(() =>
      selectRouteMiddleware({
        route: { filePath: join(routesDir, "index.js") },
        middleware: null,
      }),
    ).toThrow(
      "[Goribu] selectRouteMiddleware({ route, middleware }) requires the array returned by scanMiddleware()",
    );
    expect(() =>
      selectRouteMiddleware({
        route: { filePath: join(routesDir, "index.js") },
        middleware: [{ filePath: join(routesDir, "_middleware.js") }],
      }),
    ).toThrow(
      "[Goribu] Middleware discovery record at index 0 is invalid. Pass the array returned by scanMiddleware() without changing it",
    );
  });
});

function record(relativePath) {
  return Object.freeze({
    filePath: join(routesDir, relativePath),
    relativePath,
  });
}
