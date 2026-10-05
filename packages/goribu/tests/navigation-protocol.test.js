import { createElement as h } from "react";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "goribu/server";

const POSTS_ID = "src/routes/posts/[id].jsx";
const IMPLICIT_ID = "src/routes/about.jsx";
const REDIRECT_ID = "src/routes/go.js";
const API_ID = "src/routes/api.js";
const FILE_ID = "src/routes/file.js";
const GUARDED_ID = "src/routes/guarded.jsx";
const HEADERS_ID = "src/routes/headers.jsx";
const COOKIE_ID = "src/routes/cookie.jsx";
const MIDDLEWARE_ID = "src/routes/posts/_middleware.js";

const routes = [
  route({
    id: POSTS_ID,
    pattern: "/posts/:id",
    segments: [
      { type: "static", value: "posts" },
      { type: "dynamic", name: "id" },
    ],
    hasDefaultExport: true,
    methods: ["GET"],
  }),
  route({
    id: IMPLICIT_ID,
    pattern: "/about",
    segments: [{ type: "static", value: "about" }],
    hasDefaultExport: true,
    methods: [],
  }),
  route({
    id: REDIRECT_ID,
    pattern: "/go",
    segments: [{ type: "static", value: "go" }],
    methods: ["GET"],
  }),
  route({
    id: API_ID,
    pattern: "/api",
    segments: [{ type: "static", value: "api" }],
    methods: ["GET"],
  }),
  route({
    id: FILE_ID,
    pattern: "/file",
    segments: [{ type: "static", value: "file" }],
    methods: ["GET"],
  }),
  route({
    id: GUARDED_ID,
    pattern: "/guarded",
    segments: [{ type: "static", value: "guarded" }],
    hasDefaultExport: true,
    methods: ["GET"],
  }),
  route({
    id: HEADERS_ID,
    pattern: "/headers",
    segments: [{ type: "static", value: "headers" }],
    hasDefaultExport: true,
    methods: ["GET"],
  }),
  route({
    id: COOKIE_ID,
    pattern: "/cookie",
    segments: [{ type: "static", value: "cookie" }],
    hasDefaultExport: true,
    methods: ["GET"],
  }),
];

function PostPage({ id, query, scope }) {
  return h("main", null, `${scope}:${id}:${query}`);
}

function createNavigationApp(options = {}) {
  const backgroundTask = options.backgroundTask ?? Promise.resolve();

  return createApp({
    manifest: routes,
    errorPages: { notFound: null, serverError: null },
    documentId: null,
    middlewareByRoute: new Map([
      [
        POSTS_ID,
        [{ id: MIDDLEWARE_ID, relativePath: "posts/_middleware.js" }],
      ],
    ]),
    modules: new Map([
      [
        MIDDLEWARE_ID,
        {
          default(request, response) {
            request.navigationScope = request.headers.get("x-navigation-scope");
            response.headers({ "x-middleware": "ran" });
          },
        },
      ],
      [
        POSTS_ID,
        {
          default: PostPage,
          meta: ({ props, url }) => ({
            title: `Post ${props.id}`,
            canonical: url.href,
          }),
          GET(request, response) {
            request.waitUntil(backgroundTask);
            return response.status(202).headers({ "x-page": "posts" }).render({
              id: request.params.id,
              query: request.query.get("view"),
              url: request.url.href,
              scope: `${request.env.APP}:${request.navigationScope}`,
            });
          },
        },
      ],
      [
        IMPLICIT_ID,
        {
          default: () => h("main", null, "About"),
          meta: { title: "About" },
        },
      ],
      [
        REDIRECT_ID,
        {
          GET(request, response) {
            return response.headers({ "x-auth": "checked" }).redirect("/posts/7");
          },
        },
      ],
      [
        API_ID,
        {
          GET(request, response) {
            return response.json({ ok: true });
          },
        },
      ],
      [FILE_ID, { GET: (request, response) => response.stream(new Uint8Array([1, 2, 3])) }],
      [
        GUARDED_ID,
        {
          default: () => h("main", null, "Guarded"),
          GET(request, response) {
            return response.notFound({ gate: "auth" });
          },
        },
      ],
      [
        HEADERS_ID,
        {
          default: () => h("main", null, "Headers"),
          GET(request, response) {
            return response
              .status(302)
              .headers({
                location: "https://other.example/followed",
                "content-encoding": "gzip",
                "content-length": "1000",
                etag: '"document-representation"',
                "cdn-cache-control": "public, max-age=3600",
                "cloudflare-cdn-cache-control": "public, max-age=3600",
                "x-route-header": "preserved",
              })
              .render({ ok: true });
          },
        },
      ],
      [
        COOKIE_ID,
        {
          default: () => h("main", null, "Cookie"),
          GET(request, response) {
            request.cookies.set("navigation", "yes", {
              httpOnly: true,
              sameSite: "Lax",
            });
            return response.render({ ok: true });
          },
        },
      ],
    ]),
    mode: options.mode ?? "production",
  });
}

function request(app, path, init = {}) {
  return app.fetch(
    new Request(`https://example.com${path}`, init),
    init.env ?? { APP: "fixture" },
    init.ctx ?? { waitUntil() {} },
  );
}

describe("reserved navigation protocol", () => {
  it("runs the target page through normal request behavior and returns a render envelope", async () => {
    const backgroundTask = Promise.resolve("recorded");
    const ctx = { waitUntil: vi.fn() };
    const app = createNavigationApp({ backgroundTask });
    const target = encodeURIComponent("/posts/42?view=full#comments");

    const response = await request(
      app,
      `/_goribu/worker-nav?to=${target}`,
      {
        headers: { "x-navigation-scope": "client" },
        env: { APP: "goribu" },
        ctx,
      },
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-middleware")).toBe("ran");
    expect(response.headers.get("x-page")).toBe("posts");
    await expect(response.json()).resolves.toEqual({
      kind: "render",
      routeId: POSTS_ID,
      props: {
        id: "42",
        query: "full",
        url: "https://example.com/posts/42?view=full",
        scope: "goribu:client",
      },
      meta: {
        title: "Post 42",
        canonical: "https://example.com/posts/42?view=full",
      },
      status: 202,
    });
    expect(ctx.waitUntil).toHaveBeenCalledWith(backgroundTask);
  });

  it("turns an implicit GET page into a render envelope with empty props", async () => {
    const app = createNavigationApp();
    const response = await request(app, "/_goribu/worker-nav?to=%2Fabout");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      kind: "render",
      routeId: IMPLICIT_ID,
      props: {},
      meta: { title: "About" },
      status: 200,
    });
  });

  it("canonicalizes a target trailing slash through a 308 redirect envelope", async () => {
    const app = createNavigationApp();
    const target = encodeURIComponent("/about/?view=full");
    const response = await request(app, `/_goribu/worker-nav?to=${target}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      kind: "redirect",
      location: "/about?view=full",
      status: 308,
    });
  });

  it("turns route redirects into explicit directives without a wire Location", async () => {
    const app = createNavigationApp();
    const response = await request(app, "/_goribu/worker-nav?to=%2Fgo");

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-auth")).toBe("checked");
    await expect(response.json()).resolves.toEqual({
      kind: "redirect",
      location: "/posts/7",
      status: 303,
    });
  });

  it("removes representation headers from JSON envelopes", async () => {
    const app = createNavigationApp();
    const response = await request(app, "/_goribu/worker-nav?to=%2Fheaders");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).not.toBe("1000");
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("cdn-cache-control")).toBeNull();
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-route-header")).toBe("preserved");
    await expect(response.json()).resolves.toEqual({
      kind: "render",
      routeId: HEADERS_ID,
      props: { ok: true },
      meta: {},
      status: 302,
    });
  });

  it("flushes cookies set by the target handler onto the navigation envelope", async () => {
    const app = createNavigationApp();
    const response = await request(app, "/_goribu/worker-nav?to=%2Fcookie");

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBe(
      "navigation=yes; HttpOnly; SameSite=Lax",
    );
    await expect(response.json()).resolves.toEqual({
      kind: "render",
      routeId: COOKIE_ID,
      props: { ok: true },
      meta: {},
      status: 200,
    });
  });

  it("asks for a full load when the target cannot produce a hydratable route page", async () => {
    const app = createNavigationApp();

    for (const target of ["/api", "/file", "/guarded", "/missing"]) {
      const response = await request(
        app,
        `/_goribu/worker-nav?to=${encodeURIComponent(target)}`,
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ kind: "reload" });
    }
  });

  it("rejects malformed endpoint requests with teaching JSON errors", async () => {
    const app = createNavigationApp();

    const missing = await request(app, "/_goribu/worker-nav");
    expect(missing.status).toBe(400);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    await expect(missing.json()).resolves.toEqual({
      error: expect.stringMatching(/^\[Goribu\].*"to" query parameter/),
    });

    const method = await request(app, "/_goribu/worker-nav?to=%2Fposts%2F1", {
      method: "POST",
    });
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("GET, HEAD");

    for (const target of [
      "posts/1",
      "https://other.example/posts/1",
      "//other.example/posts/1",
      "/_goribu/worker-nav?to=/posts/1",
    ]) {
      const response = await request(
        app,
        `/_goribu/worker-nav?to=${encodeURIComponent(target)}`,
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/^\[Goribu\]/);
    }
  });

  it("supports HEAD and keeps direct route requests on the document path", async () => {
    const app = createNavigationApp();
    const target = encodeURIComponent("/posts/9?view=summary");

    const head = await request(app, `/_goribu/worker-nav?to=${target}`, {
      method: "HEAD",
      headers: { "x-navigation-scope": "head" },
    });
    expect(head.status).toBe(202);
    expect(head.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(head.body).toBeNull();

    const document = await request(app, "/posts/9?view=summary", {
      headers: {
        "x-goribu": "true",
        "x-navigation-scope": "document",
      },
    });
    expect(document.status).toBe(202);
    expect(document.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await document.text();
    expect(html).toContain("<main>fixture:document:9:summary</main>");
  });
});

function route(options) {
  return {
    id: options.id,
    pattern: options.pattern,
    segments: options.segments,
    hasDefaultExport: options.hasDefaultExport ?? false,
    methods: options.methods,
  };
}
