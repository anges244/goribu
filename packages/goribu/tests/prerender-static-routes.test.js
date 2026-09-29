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
import { matchRoute } from "../src/routing/match-route.js";
import { serializePropsForScript, serializeRouteForScript } from "../src/rendering/render-context.js";

const buildId = "1234567890abcdef1234567890abcdef";

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
  mkdirSync(join(root, ".goribu", "dist", "client"), { recursive: true });
  writeFile(root, ".goribu/dist/client/_goribu/navigation.json", JSON.stringify({ buildId, routes: null }));
  writeFile(root, join(".goribu", "dist", "app", "index.js"), "export default { fetch() {} };\n");
  writeFile(
    root,
    join(".goribu", "dist", "app", "wrangler.json"),
    JSON.stringify({ main: "index.js", assets: { directory: "../client" } }),
  );
  writeFile(
    root,
    join(".wrangler", "deploy", "config.json"),
    JSON.stringify({ configPath: "../../.goribu/dist/app/wrangler.json" }),
  );
  return join(root, ".goribu", "dist", "client");
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
  const manifest = manifestFor(created.at(-1));
  const state = { started: false, stopped: false };
  const startWorker = vi.fn(async () => {
    state.started = true;
    return {
      fetch: async (pathname) => {
        if (pathname === "/_goribu/build/uploads") return Response.json({ version: 1, routes: [] });
        const response = handler(pathname);
        if (response.status !== 200) return response;
        const id = matchRoute({ manifest, pathname, method: "GET" }).route.id;
        const suffix = `<script id="__GORIBU_ROUTE__" type="application/json">${serializeRouteForScript(id, { buildId, meta: {}, status: 200 })}</script><script id="__GORIBU_PROPS__" type="application/json">${serializePropsForScript({})}</script>`;
        // Keep stream failures as response-body failures, not rejected fetches.
        const reader = response.body.getReader();
        return new Response(new ReadableStream({
          async pull(controller) {
            const { value, done } = await reader.read();
            if (!done) controller.enqueue(value);
            else { controller.enqueue(new TextEncoder().encode(suffix)); controller.close(); }
          },
        }), { headers: response.headers });
      },
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
    const clientDir = join(root, ".goribu", "dist", "client");
    mkdirSync(clientDir, { recursive: true });
    writeFileSync(join(clientDir, "standalone.html"), "<h1>ok</h1>");

    expect(() =>
      assertNoAssetRouteCollisions({ clientDir, manifest: manifestFor(root) }),
    ).not.toThrow();
  });

  it("fails when a published HTML asset shadows a dynamic route", () => {
    const root = makeProject();
    writeRoute(root, "posts/[id].jsx");
    const clientDir = join(root, ".goribu", "dist", "client");
    mkdirSync(join(clientDir, "posts"), { recursive: true });
    writeFileSync(join(clientDir, "posts", "hello.html"), "<h1>hand</h1>");

    expect(() =>
      assertNoAssetRouteCollisions({ clientDir, manifest: manifestFor(root) }),
    ).toThrow(/posts\/hello\.html.*\/posts\/:id/s);
  });

  it("catches a percent-encoded asset name that decodes onto a route", () => {
    const root = makeProject();
    writeRoute(root, "percent%2F.jsx");
    const clientDir = join(root, ".goribu", "dist", "client");
    mkdirSync(clientDir, { recursive: true });
    writeFileSync(join(clientDir, "percent%2F.html"), "<h1>hand</h1>");

    expect(() =>
      assertNoAssetRouteCollisions({ clientDir, manifest: manifestFor(root) }),
    ).toThrow(/percent%2F\.html/);
  });

  it("ignores the reserved fingerprinted namespace", () => {
    const root = makeProject();
    writeRoute(root, "index.jsx");
    const clientDir = join(root, ".goribu", "dist", "client");
    mkdirSync(join(clientDir, "_goribu", "assets"), { recursive: true });
    writeFileSync(join(clientDir, "_goribu", "assets", "index.html"), "<h1>internal</h1>");

    expect(() =>
      assertNoAssetRouteCollisions({ clientDir, manifest: manifestFor(root) }),
    ).not.toThrow();
  });
});

describe("prerenderStaticRoutes", () => {
  it("refuses cookie-setting and non-HTML snapshots, downgrading automatic pages and rejecting forced ones", async () => {
    for (const forced of [false, true]) {
      for (const headers of [
        { "content-type": "text/html", "set-cookie": "session=private" },
        { "content-type": "application/json" },
      ]) {
        const root = makeProject();
        writeRoute(root, "index.jsx", `${forced ? "export const prerender = true;" : ""} export default function Page() { return null; }`);
        const clientDir = writeBuildOutputs(root);
        const { startWorker } = fakeStartWorker(() => new Response("not a public snapshot", { headers }));
        const result = prerenderStaticRoutes({ projectRoot: root, log: makeLog(), startWorker });
        if (forced) await expect(result).rejects.toThrow(/cookie|HTML/);
        else {
          expect((await result).prerendered).toEqual([]);
          expect(JSON.parse(readFileSync(join(clientDir, "_goribu/navigation.json"), "utf8")).routes).toEqual({});
        }
        expect(existsSync(join(clientDir, "index.html"))).toBe(false);
      }
    }
  });
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
    const navigation = JSON.parse(readFileSync(join(clientDir, "_goribu/navigation.json"), "utf8"));
    expect(Object.keys(navigation.routes).sort()).toEqual(["/", "/about"]);
    const snapshot = JSON.parse(readFileSync(join(clientDir, navigation.routes["/about"].asset), "utf8"));
    expect(snapshot).toMatchObject({ buildId, kind: "render", routeId: "src/routes/about.jsx", props: {}, meta: {}, status: 200 });
  });

  it("uses shared middleware selection to downgrade only the affected static page", async () => {
    const root = makeProject();
    writeRoute(root, "index.jsx");
    writeRoute(root, "dashboard/index.jsx");
    writeRoute(
      root,
      "dashboard/_middleware.js",
      "export default function middleware() {}\n",
    );
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
    expect(existsSync(join(clientDir, "dashboard.html"))).toBe(false);
    expect(fetched).toEqual(["/"]);
    expect(downgraded).toEqual([
      expect.objectContaining({
        id: "src/routes/dashboard/index.jsx",
        reason: expect.stringContaining(
          "src/routes/dashboard/_middleware.js",
        ),
      }),
    ]);
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

  it("explains an automatic signed-link downgrade without runtime prefixes or unnecessary repair advice", async () => {
    const root = makeProject();
    writeRoute(root, "index.jsx");
    writeBuildOutputs(root);
    const { startWorker, state } = fakeStartWorker(() => new Response(null, {
      status: 500, headers: { "x-goribu-prerender-error": "r2-signed-url" },
    }));
    const log = makeLog();

    const result = await prerenderStaticRoutes({ projectRoot: root, log, startWorker });

    expect(result.prerendered).toEqual([]);
    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      '[Goribu] Route "src/routes/index.jsx" (/) is a prerender candidate but was not ' +
      'statically output: the Worker called req.r2.signedUrl(), whose link would expire inside static HTML ' +
      'when it was rendered at build time. It will render on the Worker at request time.',
    );
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

  it("fails closed and stops the Worker when policy inspection fails", async () => {
    const root = makeProject();
    writeRoute(root, "action.js", "export const uploads = {}; export function POST() {}");
    writeBuildOutputs(root);
    for (const response of [
      new Response("missing", { status: 404 }),
      new Response("broken", { headers: { "content-type": "application/json" } }),
      Response.json({ version: 2, routes: [] }),
      Response.json({ version: 1, error: "[Goribu] Route action.js uploads.video: add direct: true." }, { status: 400 }),
    ]) {
      const stop = vi.fn();
      await expect(prerenderStaticRoutes({
        projectRoot: root, log: makeLog(),
        startWorker: async () => ({ fetch: async () => response, stop }),
      })).rejects.toThrow(/\[Goribu\]/);
      expect(stop).toHaveBeenCalledOnce();
      expect(existsSync(join(root, ".goribu/dist/app/r2-uploads.json"))).toBe(false);
    }
  });

  it.each([
    "export const uploads = {}; export function POST() {}",
    'export * from "../policies.js"; export function POST() {}',
  ])("inspects action-only and wildcard policies: %s", async (source) => {
    const root = makeProject();
    writeRoute(root, "action.js", source);
    writeBuildOutputs(root);
    const { startWorker, state } = fakeStartWorker(() => htmlResponse("ok"));
    const log = makeLog();

    const { prerendered } = await prerenderStaticRoutes({ projectRoot: root, log, startWorker });

    expect(prerendered).toEqual([]);
    expect(state.started).toBe(true);
    expect(state.stopped).toBe(true);
    expect(log.log).toHaveBeenCalledWith(expect.stringContaining("No routes were statically output"));
  });

  it("skips inspection and the harness when there are no static pages or upload exports", async () => {
    const root = makeProject();
    writeRoute(root, "posts/[id].jsx");
    writeBuildOutputs(root);
    const startWorker = vi.fn(() => { throw new Error("must not start"); });
    await prerenderStaticRoutes({ projectRoot: root, log: makeLog(), startWorker });
    expect(startWorker).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(join(root, ".goribu/dist/app/r2-uploads.json"), "utf8"))).toEqual({ version: 1, routes: [] });
  });

  it("teaches when the build output is missing", async () => {
    const root = makeProject();
    writeRoute(root, "index.jsx");

    await expect(
      prerenderStaticRoutes({ projectRoot: root, log: makeLog(), startWorker: fakeStartWorker(() => {}).startWorker }),
    ).rejects.toThrow(/deploy configuration/);
  });
});
