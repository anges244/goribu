import { describe, expect, it } from "vitest";
import {
  assetPathForRoute,
  planStaticRoutes,
  requestPathnameForRoute,
} from "../src/build/plan-static-routes.js";

function route(overrides) {
  return {
    id: "src/routes/index.jsx",
    pattern: "/",
    segments: [],
    prerenderEligible: true,
    prerenderOverride: null,
    ...overrides,
  };
}

function staticSegment(value) {
  return { type: "static", value };
}

function dynamicSegment(name) {
  return { type: "dynamic", name };
}

function middlewareOptions(routeId, ...middlewareIds) {
  const middlewareByRoute = new Map([
    [
      routeId,
      middlewareIds.map((id) => ({
        id,
        relativePath: id.replace("src/routes/", ""),
      })),
    ],
  ]);
  return {
    routesWithMiddleware: new Set(middlewareByRoute.keys()),
    middlewareByRoute,
  };
}

describe("assetPathForRoute", () => {
  it("maps the root route to index.html", () => {
    expect(assetPathForRoute(route({ segments: [] }))).toBe("index.html");
  });

  it("maps a single static segment to <segment>.html", () => {
    expect(
      assetPathForRoute(route({ pattern: "/about", segments: [staticSegment("about")] })),
    ).toBe("about.html");
  });

  it("maps nested static segments to a nested .html file", () => {
    expect(
      assetPathForRoute(
        route({
          pattern: "/blog/post",
          segments: [staticSegment("blog"), staticSegment("post")],
        }),
      ),
    ).toBe("blog/post.html");
  });

  it("refuses a route with a dynamic segment", () => {
    expect(() =>
      assetPathForRoute(route({ segments: [dynamicSegment("id")] })),
    ).toThrow(/fully static route/);
  });
});

describe("requestPathnameForRoute", () => {
  it("maps the root route to /", () => {
    expect(requestPathnameForRoute(route({ segments: [] }))).toBe("/");
  });

  it("joins static segments into a pathname", () => {
    expect(
      requestPathnameForRoute(
        route({ segments: [staticSegment("blog"), staticSegment("post")] }),
      ),
    ).toBe("/blog/post");
  });

  it("percent-encodes URL-significant characters in file names", () => {
    expect(requestPathnameForRoute(route({ segments: [staticSegment("a b")] }))).toBe("/a%20b");
    expect(requestPathnameForRoute(route({ segments: [staticSegment("percent%2F")] }))).toBe(
      "/percent%252F",
    );
  });
});

describe("planStaticRoutes", () => {
  it("statically outputs every fully static prerender candidate", () => {
    const { staticRoutes, downgraded } = planStaticRoutes([
      route({ id: "src/routes/index.jsx", pattern: "/", segments: [] }),
      route({
        id: "src/routes/about.jsx",
        pattern: "/about",
        segments: [staticSegment("about")],
      }),
    ]);

    expect(downgraded).toEqual([]);
    expect(staticRoutes).toEqual([
      { id: "src/routes/index.jsx", pattern: "/", pathname: "/", assetPath: "index.html", forced: false },
      {
        id: "src/routes/about.jsx",
        pattern: "/about",
        pathname: "/about",
        assetPath: "about.html",
        forced: false,
      },
    ]);
  });

  it("downgrades a static page with named middleware while keeping a middleware-free page static", () => {
    const middlewareRoute = route({
      id: "src/routes/dashboard.jsx",
      pattern: "/dashboard",
      segments: [staticSegment("dashboard")],
    });
    const { staticRoutes, downgraded } = planStaticRoutes(
      [route({}), middlewareRoute],
      middlewareOptions(
        middlewareRoute.id,
        "src/routes/_middleware.js",
        "src/routes/dashboard/_middleware.js",
      ),
    );

    expect(staticRoutes.map((candidate) => candidate.id)).toEqual([
      "src/routes/index.jsx",
    ]);
    expect(downgraded).toEqual([
      expect.objectContaining({
        id: middlewareRoute.id,
        reason: expect.stringContaining("src/routes/_middleware.js"),
      }),
    ]);
    expect(downgraded[0].reason).toContain(
      "src/routes/dashboard/_middleware.js",
    );
    expect(downgraded[0].reason).toContain("must run on every request");
  });

  it("fails when a middleware route explicitly forces prerendering", () => {
    const middlewareRoute = route({
      id: "src/routes/dashboard.jsx",
      pattern: "/dashboard",
      segments: [staticSegment("dashboard")],
      prerenderOverride: true,
    });

    expect(() =>
      planStaticRoutes(
        [middlewareRoute],
        middlewareOptions(
          middlewareRoute.id,
          "src/routes/dashboard/_middleware.js",
        ),
      ),
    ).toThrow(
      /export const prerender = true.*src\/routes\/dashboard\/_middleware\.js.*must run on every request/s,
    );
  });

  it("marks an explicitly forced static route as forced", () => {
    const { staticRoutes } = planStaticRoutes([
      route({
        id: "src/routes/about.jsx",
        pattern: "/about",
        segments: [staticSegment("about")],
        prerenderOverride: true,
      }),
    ]);

    expect(staticRoutes[0].forced).toBe(true);
  });

  it("downgrades a dynamic prerender candidate with a named reason", () => {
    const { staticRoutes, downgraded } = planStaticRoutes([
      route({
        id: "src/routes/posts/[id].jsx",
        pattern: "/posts/:id",
        segments: [staticSegment("posts"), dynamicSegment("id")],
      }),
    ]);

    expect(staticRoutes).toEqual([]);
    expect(downgraded).toHaveLength(1);
    expect(downgraded[0]).toMatchObject({
      id: "src/routes/posts/[id].jsx",
      pattern: "/posts/:id",
    });
    expect(downgraded[0].reason).toContain(":id");
    expect(downgraded[0].reason).toContain("not known at build time");
  });

  it("names every dynamic segment when more than one downgrades a route", () => {
    const [downgrade] = planStaticRoutes([
      route({
        id: "src/routes/[a]/[b].jsx",
        pattern: "/:a/:b",
        segments: [dynamicSegment("a"), dynamicSegment("b")],
      }),
    ]).downgraded;

    expect(downgrade.reason).toContain("dynamic segments");
    expect(downgrade.reason).toContain(":a, :b");
  });

  it("ignores routes that are not prerender candidates", () => {
    const { staticRoutes, downgraded } = planStaticRoutes([
      route({
        id: "src/routes/api.jsx",
        pattern: "/api",
        segments: [staticSegment("api")],
        prerenderEligible: false,
        prerenderOverride: false,
      }),
    ]);

    expect(staticRoutes).toEqual([]);
    expect(downgraded).toEqual([]);
  });

  it("fails the build when a route forces prerender it cannot satisfy", () => {
    expect(() =>
      planStaticRoutes([
        route({
          id: "src/routes/posts/[id].jsx",
          pattern: "/posts/:id",
          segments: [staticSegment("posts"), dynamicSegment("id")],
          prerenderOverride: true,
        }),
      ]),
    ).toThrow(/export const prerender = true/);
  });
});
