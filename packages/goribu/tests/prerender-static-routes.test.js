import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertNoAssetRouteCollisions,
  prerenderStaticRoutes,
  servedPathnameForAsset,
} from "../src/build/prerender-static-routes.js";
import { generateManifest } from "../src/routing/generate-manifest.js";

const created = [];

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "goribu-prerender-"));
  created.push(root);
  return root;
}

function writeFile(root, relativePath, source) {
  const filePath = join(root, relativePath);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, source);
}

function writeRoute(root, relativePath, source = "export default function Page() { return null; }\n") {
  writeFile(root, join("src", "routes", relativePath), source);
}

// Give the orchestrator the deploy handoff it reads to locate the Worker entry
// and the client asset directory, plus the directory itself.
function writeBuildOutputs(root) {
  mkdirSync(join(root, "dist", "client"), { recursive: true });
  writeFile(root, join("dist", "app", "index.js"), "export default { fetch() {} };\n");
  writeFile(
    root,
    join("dist", "app", "wrangler.json"),
    JSON.stringify({ main: "index.js", assets: { directory: "../client" } }),
  );
  writeFile(
    root,
    join(".wrangler", "deploy", "config.json"),
    JSON.stringify({ configPath: "../../dist/app/wrangler.json" }),
  );
  return join(root, "dist", "client");
}

function manifestFor(root) {
  return generateManifest({ routesDir: join(root, "src", "routes"), projectRoot: root });
}

function makeLog() {
  return { warn: vi.fn(), log: vi.fn() };
}

function htmlResponse(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

// A 200 response whose body stream errors after the shell — the shape of a React
// render that throws below a Suspense boundary once streaming has begun.
function streamErrorResponse() {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<!DOCTYPE html><body>"));
      controller.error(new Error("stream boom"));
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

// A fake Worker runner: `handler(pathname)` returns a Response or throws. Records
// whether the Worker was started and stopped so lifecycle can be asserted.
function fakeStartWorker(handler) {
  const state = { started: false, stopped: false };
  const startWorker = vi.fn(async () => {
    state.started = true;
    return {
      fetch: (pathname) => handler(pathname),
      stop: async () => {
        state.stopped = true;
      },
    };
  });
  return { startWorker, state };
}

afterEach(() => {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("servedPathnameForAsset", () => {
  it("maps HTML files to the clean URLs Static Assets serves them at", () => {
    expect(servedPathnameForAsset("index.html")).toBe("/");
    expect(servedPathnameForAsset("about.html")).toBe("/about");
    expect(servedPathnameForAsset("posts/hello.html")).toBe("/posts/hello");
    expect(servedPathnameForAsset("blog/index.html")).toBe("/blog");
  });

  it("percent-encodes URL-significant characters so the matcher decodes them back", () => {
    expect(servedPathnameForAsset("percent%2F.html")).toBe("/percent%252F");
    expect(servedPathnameForAsset("a b.html")).toBe("/a%20b");
  });
});

describe("assertNoAssetRouteCollisions", () => {
  it("passes when no published HTML asset owns a route URL", () => {
    const root = makeProject();
    writeRoute(root, "about.jsx");
    const clientDir = join(root, "dist", "client");
    mkdirSync(clientDir, { recursive: true });
    writeFileSync(join(clientDir, "standalone.html"), "<h1>ok</h1>");

    expect(() =>
      assertNoAssetRouteCollisions({ clientDir, manifest: manifestFor(root) }),
    ).not.toThrow();
  });

  it("fails when a published HTML asset shadows a dynamic route", () => {
    const root = makeProject();
    writeRoute(root, "posts/[id].jsx");
    const clientDir = join(root, "dist", "client");
    mkdirSync(join(clientDir, "posts"), { recursive: true });
    writeFileSync(join(clientDir, "posts", "hello.html"), "<h1>hand</h1>");

    expect(() =>
      assertNoAssetRouteCollisions({ clientDir, manifest: manifestFor(root) }),
    ).toThrow(/posts\/hello\.html.*\/posts\/:id/s);
  });

  it("catches a percent-encoded asset name that decodes onto a route", () => {
    const root = makeProject();
    writeRoute(root, "percent%2F.jsx");
    const clientDir = join(root, "dist", "client");
    mkdirSync(clientDir, { recursive: true });
    writeFileSync(join(clientDir, "percent%2F.html"), "<h1>hand</h1>");

    expect(() =>
      assertNoAssetRouteCollisions({ clientDir, manifest: manifestFor(root) }),
    ).toThrow(/percent%2F\.html/);
  });

  it("ignores the reserved fingerprinted namespace", () => {
    const root = makeProject();
    writeRoute(root, "index.jsx");
    const clientDir = join(root, "dist", "client");
    mkdirSync(join(clientDir, "_goribu", "assets"), { recursive: true });
    writeFileSync(join(clientDir, "_goribu", "assets", "index.html"), "<h1>internal</h1>");

    expect(() =>
      assertNoAssetRouteCollisions({ clientDir, manifest: manifestFor(root) }),
    ).not.toThrow();
  });
});

describe("prerenderStaticRoutes", () => {
  it("writes an HTML asset for each static route the Worker renders", async () => {
    const root = makeProject();
    writeRoute(root, "index.jsx");
    writeRoute(root, "about.jsx");
    const clientDir = writeBuildOutputs(root);
    const { startWorker, state } = fakeStartWorker((pathname) =>
      htmlResponse(`<!DOCTYPE html><title>${pathname}</title>`),
    );
    const log = makeLog();

    const { prerendered, downgraded } = await prerenderStaticRoutes({
      projectRoot: root,
      log,
      startWorker,
    });

    expect(downgraded).toEqual([]);
    expect(prerendered.map((route) => route.assetPath).sort()).toEqual(["about.html", "index.html"]);
    expect(readFileSync(join(clientDir, "index.html"), "utf8")).toContain("<title>/</title>");
    expect(readFileSync(join(clientDir, "about.html"), "utf8")).toContain("<title>/about</title>");
    expect(log.log).toHaveBeenCalledWith(expect.stringContaining("Statically output 2 route(s)"));
    expect(state.started).toBe(true);
    expect(state.stopped).toBe(true);
  });

  it("structurally downgrades a dynamic route without fetching it", async () => {
    const root = makeProject();
    writeRoute(root, "index.jsx");
    writeRoute(root, "posts/[id].jsx");
    const clientDir = writeBuildOutputs(root);
    const fetched = [];
    const { startWorker } = fakeStartWorker((pathname) => {
      fetched.push(pathname);
      return htmlResponse("<!DOCTYPE html>ok");
    });
    const log = makeLog();

    const { prerendered, downgraded } = await prerenderStaticRoutes({
      projectRoot: root,
      log,
      startWorker,
    });

    expect(prerendered.map((route) => route.assetPath)).toEqual(["index.html"]);
    expect(existsSync(join(clientDir, "posts"))).toBe(false);
    expect(fetched).toEqual(["/"]);
    expect(downgraded).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Route "src/routes/posts/[id].jsx" (/posts/:id) is a prerender candidate'),
    );
  });

  it("downgrades an automatic candidate the Worker cannot render, and keeps the others", async () => {
    const root = makeProject();
    writeRoute(root, "index.jsx");
    writeRoute(root, "about.jsx");
    const clientDir = writeBuildOutputs(root);
    const { startWorker, state } = fakeStartWorker((pathname) =>
      pathname === "/about" ? htmlResponse("boom", 500) : htmlResponse("<!DOCTYPE html>ok"),
    );
    const log = makeLog();

    const { prerendered, downgraded } = await prerenderStaticRoutes({
      projectRoot: root,
      log,
      startWorker,
    });

    expect(prerendered.map((route) => route.assetPath)).toEqual(["index.html"]);
    expect(existsSync(join(clientDir, "about.html"))).toBe(false);
    expect(downgraded).toEqual([
      expect.objectContaining({ id: "src/routes/about.jsx", reason: expect.stringContaining("responded 500") }),
    ]);
    expect(state.stopped).toBe(true);
  });

  it("downgrades an automatic candidate whose body stream fails after a 200", async () => {
    const root = makeProject();
    writeRoute(root, "index.jsx");
    writeRoute(root, "about.jsx");
    const clientDir = writeBuildOutputs(root);
    const { startWorker } = fakeStartWorker((pathname) =>
      pathname === "/about" ? streamErrorResponse() : htmlResponse("<!DOCTYPE html>ok"),
    );
    const log = makeLog();

    const { prerendered, downgraded } = await prerenderStaticRoutes({
      projectRoot: root,
      log,
      startWorker,
    });

    expect(prerendered.map((route) => route.assetPath)).toEqual(["index.html"]);
    expect(existsSync(join(clientDir, "about.html"))).toBe(false);
    expect(downgraded).toEqual([
      expect.objectContaining({
        id: "src/routes/about.jsx",
        reason: expect.stringContaining("failed while streaming"),
      }),
    ]);
  });

  it("fails the build when the workerd harness rejects a fetch", async () => {
    const root = makeProject();
    writeRoute(root, "index.jsx");
    writeBuildOutputs(root);
    const { startWorker, state } = fakeStartWorker(() => {
      throw new Error("harness gone");
    });

    await expect(
      prerenderStaticRoutes({ projectRoot: root, log: makeLog(), startWorker }),
    ).rejects.toThrow(/workerd harness may have crashed/);
    expect(state.stopped).toBe(true);
  });

  it("fails the build when a forced route cannot be rendered, still stopping the Worker", async () => {
    const root = makeProject();
    writeRoute(
      root,
      "about.jsx",
      "export const prerender = true;\nexport default function Page() { return null; }\n",
    );
    writeBuildOutputs(root);
    const { startWorker, state } = fakeStartWorker(() => htmlResponse("boom", 500));

    await expect(
      prerenderStaticRoutes({ projectRoot: root, log: makeLog(), startWorker }),
    ).rejects.toThrow(/export const prerender = true.*responded 500/s);
    expect(state.stopped).toBe(true);
  });

  it("audits assets and never starts the Worker when a published asset shadows a route", async () => {
    const root = makeProject();
    writeRoute(root, "posts/[id].jsx");
    const clientDir = writeBuildOutputs(root);
    mkdirSync(join(clientDir, "posts"), { recursive: true });
    writeFileSync(join(clientDir, "posts", "hello.html"), "<h1>hand</h1>");
    const { startWorker, state } = fakeStartWorker(() => htmlResponse("ok"));

    await expect(
      prerenderStaticRoutes({ projectRoot: root, log: makeLog(), startWorker }),
    ).rejects.toThrow(/posts\/hello\.html/);
    expect(state.started).toBe(false);
  });

  it("reports when nothing is statically output and never starts the Worker", async () => {
    const root = makeProject();
    writeRoute(root, "posts/[id].jsx");
    writeBuildOutputs(root);
    const { startWorker, state } = fakeStartWorker(() => htmlResponse("ok"));
    const log = makeLog();

    const { prerendered } = await prerenderStaticRoutes({ projectRoot: root, log, startWorker });

    expect(prerendered).toEqual([]);
    expect(state.started).toBe(false);
    expect(log.log).toHaveBeenCalledWith(expect.stringContaining("No routes were statically output"));
  });

  it("teaches when the build output is missing", async () => {
    const root = makeProject();
    writeRoute(root, "index.jsx");

    await expect(
      prerenderStaticRoutes({ projectRoot: root, log: makeLog(), startWorker: fakeStartWorker(() => {}).startWorker }),
    ).rejects.toThrow(/deploy configuration/);
  });
});
