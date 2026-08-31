import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { generateManifest } from "../src/routing/generate-manifest.js";
import { matchRoute } from "../src/routing/match-route.js";

const staticSegment = (value) => ({ type: "static", value });
const dynamicSegment = (name) => ({ type: "dynamic", name });
const cleanupDirs = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("matchRoute", () => {
  it("consumes a generated manifest and resolves specificity before methods", () => {
    const { projectRoot, routesDir } = createRoutes({
      "café.js": `export function GET() {}`,
      "posts/[id].js": `export function GET() {}`,
      "posts/new.js": `export function POST() {}`,
    });
    const manifest = generateManifest({ routesDir, projectRoot });
    const staticRoute = manifest.find(
      (route) => route.id === "src/routes/posts/new.js",
    );
    const dynamicRoute = manifest.find(
      (route) => route.id === "src/routes/posts/[id].js",
    );

    expect(
      matchRoute({ manifest, pathname: "/posts/new/", method: "POST" }),
    ).toMatchObject({
      kind: "handler",
      route: staticRoute,
      params: {},
      method: "POST",
    });
    expect(
      matchRoute({ manifest, pathname: "/posts/new", method: "GET" }),
    ).toEqual({
      kind: "method-not-allowed",
      route: staticRoute,
      params: {},
      allowedMethods: ["POST", "OPTIONS"],
    });
    expect(
      matchRoute({ manifest, pathname: "/posts/42", method: "GET" }),
    ).toMatchObject({
      kind: "handler",
      route: dynamicRoute,
      params: { id: "42" },
      method: "GET",
    });
    expect(
      matchRoute({
        manifest,
        pathname: new URL("https://example.com/café").pathname,
        method: "GET",
      }),
    ).toMatchObject({
      kind: "handler",
      route: { id: "src/routes/café.js" },
    });
    expect(
      matchRoute({ manifest, pathname: "/missing", method: "GET" }),
    ).toEqual({ kind: "not-found" });
  });

  it("decodes dynamic parameters without letting parameter names alter objects", () => {
    const matchedRoute = route({
      id: "src/routes/teams/[name]/[__proto__].js",
      segments: [
        staticSegment("teams"),
        dynamicSegment("name"),
        dynamicSegment("__proto__"),
      ],
      methods: ["GET"],
    });

    const result = matchRoute({
      manifest: [matchedRoute],
      pathname: "/teams/Goribu%20Team/member%2Fadmin",
      method: "GET",
    });

    expect(result.params.name).toBe("Goribu Team");
    expect(Object.hasOwn(result.params, "__proto__")).toBe(true);
    expect(result.params.__proto__).toBe("member/admin");
    expect(JSON.stringify(result.params)).toBe(
      '{"name":"Goribu Team","__proto__":"member/admin"}',
    );
  });

  it("treats malformed parameter encoding as a path miss", () => {
    const manifest = [
      route({
        id: "src/routes/posts/[id].js",
        segments: [staticSegment("posts"), dynamicSegment("id")],
        methods: ["GET"],
      }),
    ];

    expect(
      matchRoute({ manifest, pathname: "/posts/%ZZ", method: "GET" }),
    ).toEqual({ kind: "not-found" });
  });

  it("distinguishes explicit handlers, implicit page GET, and HEAD behavior", () => {
    const pageRoute = route({
      id: "src/routes/form.jsx",
      segments: [staticSegment("form")],
      hasDefaultExport: true,
      methods: ["POST"],
    });
    const explicitGetRoute = route({
      id: "src/routes/report.jsx",
      segments: [staticSegment("report")],
      hasDefaultExport: true,
      methods: ["GET", "HEAD"],
    });
    const getEndpoint = route({
      id: "src/routes/api/status.js",
      segments: [staticSegment("api"), staticSegment("status")],
      methods: ["GET"],
    });
    const postEndpoint = route({
      id: "src/routes/api/submit.js",
      segments: [staticSegment("api"), staticSegment("submit")],
      methods: ["POST"],
    });
    const headEndpoint = route({
      id: "src/routes/api/probe.js",
      segments: [staticSegment("api"), staticSegment("probe")],
      methods: ["HEAD"],
    });

    expect(
      matchRoute({ manifest: [pageRoute], pathname: "/form", method: "GET" }),
    ).toEqual({ kind: "page", route: pageRoute, params: {} });
    expect(
      matchRoute({ manifest: [pageRoute], pathname: "/form", method: "POST" }),
    ).toEqual({
      kind: "handler",
      route: pageRoute,
      params: {},
      method: "POST",
    });
    expect(
      matchRoute({
        manifest: [explicitGetRoute],
        pathname: "/report",
        method: "GET",
      }),
    ).toMatchObject({ kind: "handler", method: "GET" });
    expect(
      matchRoute({
        manifest: [explicitGetRoute],
        pathname: "/report",
        method: "HEAD",
      }),
    ).toMatchObject({ kind: "handler", method: "HEAD" });
    expect(
      matchRoute({ manifest: [pageRoute], pathname: "/form", method: "HEAD" }),
    ).toEqual({
      kind: "automatic-head",
      route: pageRoute,
      params: {},
      target: { kind: "page" },
    });
    expect(
      matchRoute({
        manifest: [getEndpoint],
        pathname: "/api/status",
        method: "HEAD",
      }),
    ).toEqual({
      kind: "automatic-head",
      route: getEndpoint,
      params: {},
      target: { kind: "handler", method: "GET" },
    });
    expect(
      matchRoute({
        manifest: [postEndpoint],
        pathname: "/api/submit",
        method: "HEAD",
      }),
    ).toEqual({
      kind: "method-not-allowed",
      route: postEndpoint,
      params: {},
      allowedMethods: ["POST", "OPTIONS"],
    });
    expect(
      matchRoute({
        manifest: [headEndpoint],
        pathname: "/api/probe",
        method: "HEAD",
      }),
    ).toEqual({
      kind: "handler",
      route: headEndpoint,
      params: {},
      method: "HEAD",
    });
  });

  it("returns canonical Allow methods for automatic OPTIONS and 405", () => {
    const pageRoute = route({
      id: "src/routes/forms/[id].jsx",
      segments: [staticSegment("forms"), dynamicSegment("id")],
      hasDefaultExport: true,
      methods: ["POST"],
    });
    const optionsRoute = route({
      id: "src/routes/health.js",
      segments: [staticSegment("health")],
      methods: ["GET", "OPTIONS"],
    });
    const allowedMethods = ["GET", "POST", "HEAD", "OPTIONS"];

    expect(
      matchRoute({
        manifest: [pageRoute],
        pathname: "/forms/new%20member",
        method: "OPTIONS",
      }),
    ).toEqual({
      kind: "automatic-options",
      route: pageRoute,
      params: { id: "new member" },
      allowedMethods,
    });
    expect(
      matchRoute({
        manifest: [pageRoute],
        pathname: "/forms/new%20member",
        method: "DELETE",
      }),
    ).toEqual({
      kind: "method-not-allowed",
      route: pageRoute,
      params: { id: "new member" },
      allowedMethods,
    });
    expect(
      matchRoute({
        manifest: [optionsRoute],
        pathname: "/health",
        method: "OPTIONS",
      }),
    ).toEqual({
      kind: "handler",
      route: optionsRoute,
      params: {},
      method: "OPTIONS",
    });
  });

  it("rejects non-pathname input with a repair instruction", () => {
    expect(() =>
      matchRoute({
        manifest: [],
        pathname: "https://example.com/posts",
        method: "GET",
      }),
    ).toThrow(
      "[Goribu] Cannot match route pathname \"https://example.com/posts\". Pass URL.pathname",
    );
  });
});

function route({
  id,
  segments,
  hasDefaultExport = false,
  methods = [],
}) {
  return {
    id,
    filePath: `/${id}`,
    pattern:
      segments.length === 0
        ? "/"
        : `/${segments
            .map((segment) =>
              segment.type === "static" ? segment.value : `:${segment.name}`,
            )
            .join("/")}`,
    segments,
    hasDefaultExport,
    methods,
    prerenderOverride: null,
    prerenderEligible: hasDefaultExport && !methods.includes("GET"),
  };
}

function createRoutes(files) {
  const projectRoot = mkdtempSync(join(tmpdir(), "goribu-matcher-"));
  const routesDir = join(projectRoot, "src/routes");
  cleanupDirs.push(projectRoot);

  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = join(routesDir, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }

  return { projectRoot, routesDir };
}
