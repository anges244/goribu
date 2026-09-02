import { createElement as h } from "react";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/runtime/create-app.js";

// Minimal manifest entries in the shape generateManifest() produces. Matching
// only needs id, segments, methods, and hasDefaultExport.
const INDEX = { id: "index", pattern: "/", segments: [], methods: [], hasDefaultExport: true };
const ABOUT = {
  id: "about",
  pattern: "/about",
  segments: [{ type: "static", value: "about" }],
  methods: [],
  hasDefaultExport: true,
};
const POST = {
  id: "post",
  pattern: "/posts/:id",
  segments: [
    { type: "static", value: "posts" },
    { type: "dynamic", name: "id" },
  ],
  methods: [],
  hasDefaultExport: true,
};

// Handler-route manifest entries. A route that exports method handlers carries
// those method names; hasDefaultExport is false unless it also exports a page.
const HELLO_HANDLER = {
  id: "hello",
  pattern: "/hello",
  segments: [{ type: "static", value: "hello" }],
  methods: ["GET", "POST"],
  hasDefaultExport: false,
};
const ITEM_HANDLER = {
  id: "item",
  pattern: "/items/:id",
  segments: [
    { type: "static", value: "items" },
    { type: "dynamic", name: "id" },
  ],
  methods: ["GET"],
  hasDefaultExport: false,
};
// A route that exports both a default page and a GET handler: the explicit
// handler answers GET, so the page never renders for it.
const MIXED = {
  id: "mixed",
  pattern: "/mixed",
  segments: [{ type: "static", value: "mixed" }],
  methods: ["GET"],
  hasDefaultExport: true,
};

function pageModule(text) {
  return { default: () => h("h1", null, text) };
}

function build(overrides = {}) {
  return createApp({
    manifest: [INDEX, ABOUT, POST],
    modules: new Map([
      ["index", pageModule("Home")],
      ["about", pageModule("About")],
      ["post", pageModule("A post")],
    ]),
    errorPages: { notFound: null },
    documentId: null,
    ...overrides,
  });
}

const get = (path) => new Request(`https://example.com${path}`);
const CTX = () => ({ waitUntil: () => {} });
const dispatch = (app, request) => app.fetch(request, {}, CTX());

async function developmentErrorBody(app, request) {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await dispatch(app, request);
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    return await response.text();
  } finally {
    consoleError.mockRestore();
  }
}

describe("createApp().fetch", () => {
  it("renders a matched page as a streamed HTML document", async () => {
    const response = await dispatch(build(), get("/"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    // The default document owns html/head/body and the hydration root.
    expect(body).toContain("<html>");
    expect(body).toContain('<div id="root">');
    expect(body).toContain("<h1>Home</h1>");
  });

  it("matches a dynamic segment and renders the same page for any value", async () => {
    const response = await dispatch(build(), get("/posts/hello-world"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<h1>A post</h1>");
  });

  it("redirects a trailing slash to the canonical path with 308", async () => {
    const response = await dispatch(build(), get("/about/"));
    expect(response.status).toBe(308);
    expect(new URL(response.headers.get("location")).pathname).toBe("/about");
  });

  it("drops repeated trailing slashes and preserves the query in one redirect", async () => {
    const response = await dispatch(build(), get("/posts/hello//?page=2"));
    expect(response.status).toBe(308);
    const location = new URL(response.headers.get("location"));
    expect(location.pathname).toBe("/posts/hello");
    expect(location.search).toBe("?page=2");
  });

  it("does not redirect the root path", async () => {
    expect((await dispatch(build(), get("/"))).status).toBe(200);
  });

  it("streams the built-in 404 page when no route matches", async () => {
    const response = await dispatch(build(), get("/missing"));
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("could not be found");
  });

  it("uses a discovered _404 page when one is provided", async () => {
    const app = build({
      modules: new Map([
        ["index", pageModule("Home")],
        ["about", pageModule("About")],
        ["post", pageModule("A post")],
        ["notfound", pageModule("Custom missing")],
      ]),
      errorPages: { notFound: "notfound" },
    });
    const response = await dispatch(app, get("/missing"));
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("<h1>Custom missing</h1>");
  });

  it("wraps pages in a discovered _document when one is provided", async () => {
    const app = build({
      modules: new Map([
        ["index", pageModule("Home")],
        ["about", pageModule("About")],
        ["post", pageModule("A post")],
        ["doc", { default: ({ children }) => h("html", { "data-custom": "" }, children) }],
      ]),
      documentId: "doc",
    });
    const body = await (await dispatch(app, get("/"))).text();
    expect(body).toContain('data-custom=""');
    expect(body).toContain("<h1>Home</h1>");
  });

  it("answers HEAD with the page status and no body", async () => {
    const response = await dispatch(build(), new Request("https://example.com/", { method: "HEAD" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("answers HEAD for an unmatched route with a 404 status and no body", async () => {
    const response = await dispatch(
      build(),
      new Request("https://example.com/missing", { method: "HEAD" }),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("answers HEAD for an unmatched route with a custom _404 and no body", async () => {
    const app = build({
      modules: new Map([
        ["index", pageModule("Home")],
        ["about", pageModule("About")],
        ["post", pageModule("A post")],
        ["notfound", pageModule("Custom missing")],
      ]),
      errorPages: { notFound: "notfound" },
    });
    const response = await dispatch(
      app,
      new Request("https://example.com/missing", { method: "HEAD" }),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("answers automatic OPTIONS with 204 and an Allow header", async () => {
    const response = await dispatch(build(), new Request("https://example.com/", { method: "OPTIONS" }));
    expect(response.status).toBe(204);
    expect(response.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
  });

  it("answers an unsupported method with 405 and an Allow header", async () => {
    const response = await dispatch(build(), new Request("https://example.com/", { method: "POST" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
  });

  it("discloses the teaching error when a matched route module has no default export", async () => {
    const app = build({
      mode: "development",
      modules: new Map([
        ["index", {}],
        ["about", pageModule("About")],
        ["post", pageModule("A post")],
      ]),
    });
    await expect(developmentErrorBody(app, get("/"))).resolves.toContain(
      "[Goribu] The route module \"index\" has no default-exported React component. Export a React component as the file's default export.",
    );
  });
});

describe("createApp().fetch(request, env, ctx)", () => {
  const ROOT_MIDDLEWARE = "src/routes/_middleware.js";

  it("passes the exact env bindings object to middleware and the handler", async () => {
    const bindings = { API_TOKEN: "secret" };
    let middlewareRequest;
    let handlerRequest;
    const app = createApp({
      manifest: [HELLO_HANDLER],
      modules: new Map([
        [
          ROOT_MIDDLEWARE,
          {
            default: (req) => {
              middlewareRequest = req;
            },
          },
        ],
        [
          "hello",
          {
            GET: (req, res) => {
              handlerRequest = req;
              return res.json({ token: req.env.API_TOKEN });
            },
          },
        ],
      ]),
      errorPages: { notFound: null },
      documentId: null,
      middlewareByRoute: new Map([
        [
          "hello",
          [{ id: ROOT_MIDDLEWARE, relativePath: "_middleware.js" }],
        ],
      ]),
    });

    const response = await app.fetch(get("/hello"), bindings, CTX());

    expect(middlewareRequest.env).toBe(bindings);
    expect(handlerRequest.env).toBe(bindings);
    expect(await response.json()).toEqual({ token: "secret" });
  });

  it("forwards req.waitUntil to the bound execution context and returns undefined", async () => {
    const promise = Promise.resolve();
    let waitUntilResult;
    let ctx;
    const waitUntil = vi.fn(function (received) {
      expect(this).toBe(ctx);
      expect(received).toBe(promise);
    });
    ctx = { waitUntil };
    const app = createApp({
      manifest: [HELLO_HANDLER],
      modules: new Map([
        [
          "hello",
          {
            GET: (req, res) => {
              waitUntilResult = req.waitUntil(promise);
              return res.json({ ok: true });
            },
          },
        ],
      ]),
      errorPages: { notFound: null },
      documentId: null,
    });

    const response = await app.fetch(get("/hello"), {}, ctx);

    expect(response.status).toBe(200);
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(waitUntilResult).toBeUndefined();
  });

  it("discloses the teaching error when req.waitUntil receives a non-promise", async () => {
    const app = createApp({
      manifest: [HELLO_HANDLER],
      modules: new Map([
        [
          "hello",
          {
            GET: (req) => req.waitUntil("not a promise"),
          },
        ],
      ]),
      errorPages: { notFound: null },
      documentId: null,
      mode: "development",
    });

    await expect(developmentErrorBody(app, get("/hello"))).resolves.toContain(
      "[Goribu] req.waitUntil(promise) requires a Promise. Pass the asynchronous work returned by the background operation.",
    );
  });

  it("keeps the raw execution context private from routes", async () => {
    let handlerRequest;
    const app = createApp({
      manifest: [HELLO_HANDLER],
      modules: new Map([
        [
          "hello",
          {
            GET: (req, res) => {
              handlerRequest = req;
              return res.json({ hasContext: "ctx" in req });
            },
          },
        ],
      ]),
      errorPages: { notFound: null },
      documentId: null,
    });

    const response = await dispatch(app, get("/hello"));

    expect(handlerRequest).not.toHaveProperty("ctx");
    expect(await response.json()).toEqual({ hasContext: false });
  });

  it("rejects a non-Request before the request error boundary", async () => {
    await expect(build().fetch({}, {}, CTX())).rejects.toThrow(
      "[Goribu] app.fetch(request, env, ctx) requires a Web Request as its first argument. Pass the Request received by the Cloudflare Worker fetch handler.",
    );
  });

  it.each([[undefined], [null], [[]]])(
    "rejects invalid env before the request error boundary: %j",
    async (env) => {
      await expect(build().fetch(get("/"), env, CTX())).rejects.toThrow(
        "[Goribu] app.fetch(request, env, ctx) requires the Worker bindings object as its second argument. Pass env from the Cloudflare Worker fetch handler, using {} when no bindings are configured.",
      );
    },
  );

  it.each([undefined, null, {}, { waitUntil: null }])(
    "rejects an invalid execution context before the request error boundary: %j",
    async (ctx) => {
      await expect(build().fetch(get("/"), {}, ctx)).rejects.toThrow(
        "[Goribu] app.fetch(request, env, ctx) requires the Worker execution context with ctx.waitUntil as its third argument. Pass ctx from the Cloudflare Worker fetch handler.",
      );
    },
  );
});

describe("createApp().fetch — error boundaries", () => {
  const SERVER_ERROR = "src/routes/_500.jsx";
  const ERROR_MIDDLEWARE = "src/routes/_middleware.js";

  it("renders and logs one correlated production _500 without disclosing the error or query", async () => {
    const failure = new Error("database password leaked");
    let pageProps;
    function ServerErrorPage(props) {
      pageProps = props;
      return h("main", null, `Reference ${props.errorId} at ${props.url}`);
    }
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const app = createApp({
        manifest: [HELLO_HANDLER],
        modules: new Map([
          ["hello", { GET: () => { throw failure; } }],
          [SERVER_ERROR, { default: ServerErrorPage }],
        ]),
        errorPages: { notFound: null, serverError: SERVER_ERROR },
        documentId: null,
        mode: "production",
      });
      const response = await dispatch(
        app,
        get("/hello?token=query-secret"),
      );
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(pageProps).toEqual({
        url: "/hello",
        errorId: expect.any(String),
      });
      expect(body).toContain(`Reference ${pageProps.errorId} at /hello`);
      expect(body).not.toContain(failure.message);
      expect(body).not.toContain("query-secret");
      expect(consoleError).toHaveBeenCalledWith(
        `[Goribu] Unhandled error ${pageProps.errorId}:`,
        failure,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("treats a hostile thrown Proxy as an opaque production failure", async () => {
    const hostile = new Proxy(
      {},
      {
        get(target, property, receiver) {
          if (
            property === "message" ||
            property === "status" ||
            typeof property === "symbol"
          ) {
            throw new Error("property trap must not escape the boundary");
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const app = createApp({
        manifest: [HELLO_HANDLER],
        modules: new Map([
          ["hello", { GET: () => { throw hostile; } }],
        ]),
        errorPages: { notFound: null, serverError: null },
        documentId: null,
      });
      const response = await dispatch(app, get("/hello"));
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(body).toContain("Something went wrong.");
      expect(body).toContain("Error ID:");
      expect(consoleError.mock.calls[0][0]).toMatch(
        /^\[Goribu\] Unhandled error .+:$/,
      );
      expect(consoleError.mock.calls[0][1]).toBe(hostile);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("discloses unexpected development failures without rendering _500 or exposing the query", async () => {
    const failure = new Error("database unavailable");
    failure.stack = "Error: database unavailable\n    at GET (/app/routes/hello.js:1:1)";
    const ServerErrorPage = vi.fn(() => h("main", null, "Must not render"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const app = createApp({
        manifest: [HELLO_HANDLER],
        modules: new Map([
          ["hello", { GET: () => { throw failure; } }],
          [SERVER_ERROR, { default: ServerErrorPage }],
        ]),
        errorPages: { notFound: null, serverError: SERVER_ERROR },
        documentId: null,
        mode: "development",
      });
      const response = await dispatch(app, get("/hello?token=query-secret"));
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(body).toContain(failure.stack);
      expect(body).toContain('while handling "/hello"');
      expect(body).not.toContain("query-secret");
      expect(body).not.toContain("Error ID:");
      expect(ServerErrorPage).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        "[Goribu] Development request failed:",
        failure,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it.each(["development", "production"])(
    "maps a malformed-body HttpError to its safe 400 response in %s",
    async (mode) => {
      const ServerErrorPage = vi.fn(() => h("main", null, "Must not render"));
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        const app = createApp({
          manifest: [HELLO_HANDLER],
          modules: new Map([
            [
              "hello",
              { POST: async (req, res) => res.json(await req.body()) },
            ],
            [SERVER_ERROR, { default: ServerErrorPage }],
          ]),
          errorPages: { notFound: null, serverError: SERVER_ERROR },
          documentId: null,
          mode,
        });
        const response = await dispatch(
          app,
          new Request("https://example.com/hello?token=query-secret", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{ broken",
          }),
        );
        const body = await response.text();

        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toBe(
          "text/plain; charset=utf-8",
        );
        expect(body).toContain(
          "[Goribu] Could not parse the application/json request body. Send valid JSON, or use rawBody() when the payload is not JSON.",
        );
        expect(body).not.toContain("query-secret");
        expect(ServerErrorPage).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
    },
  );

  it("falls back to plain text with the same error ID when custom _500 rendering fails", async () => {
    const failure = new Error("handler failed");
    const renderFailure = new Error("custom _500 failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const app = createApp({
        manifest: [HELLO_HANDLER],
        modules: new Map([
          ["hello", { GET: () => { throw failure; } }],
          [SERVER_ERROR, { default: () => { throw renderFailure; } }],
        ]),
        errorPages: { notFound: null, serverError: SERVER_ERROR },
        documentId: null,
      });
      const response = await dispatch(app, get("/hello"));
      const body = await response.text();
      const firstLog = consoleError.mock.calls.find(
        ([message]) =>
          typeof message === "string" &&
          message.startsWith("[Goribu] Unhandled error "),
      );
      const errorId = firstLog[0].slice(
        "[Goribu] Unhandled error ".length,
        -1,
      );

      expect(response.status).toBe(500);
      expect(body).toBe(`Internal Server Error\nError ID: ${errorId}`);
      expect(firstLog[1]).toBe(failure);
      expect(consoleError).toHaveBeenCalledWith(
        `[Goribu] _500 rendering failed for error ${errorId}:`,
        expect.objectContaining({ cause: renderFailure }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("flushes cookies queued by middleware before a downstream production failure", async () => {
    const failure = new Error("handler failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const app = createApp({
        manifest: [HELLO_HANDLER],
        modules: new Map([
          [
            ERROR_MIDDLEWARE,
            {
              default: (req) => {
                req.cookies.set("before-error", "yes", { httpOnly: true });
              },
            },
          ],
          ["hello", { GET: () => { throw failure; } }],
        ]),
        errorPages: { notFound: null, serverError: null },
        documentId: null,
        middlewareByRoute: new Map([
          [
            "hello",
            [
              {
                id: ERROR_MIDDLEWARE,
                relativePath: "_middleware.js",
              },
            ],
          ],
        ]),
      });
      const response = await dispatch(app, get("/hello"));

      expect(response.status).toBe(500);
      expect(response.headers.get("set-cookie")).toBe(
        "before-error=yes; HttpOnly",
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("createApp().fetch — middleware", () => {
  const ROOT_MIDDLEWARE = "src/routes/_middleware.js";
  const HELLO_MIDDLEWARE = "src/routes/hello/_middleware.js";

  function descriptor(id) {
    return { id, relativePath: id.replace("src/routes/", "") };
  }

  function middlewareApp({ manifest, modules, middlewareByRoute, mode }) {
    return createApp({
      manifest,
      modules,
      errorPages: { notFound: null },
      documentId: null,
      middlewareByRoute,
      mode,
    });
  }

  it("runs outer modules and array exports in order before a handler with one shared req/res", async () => {
    let middlewareRequest;
    let handlerRequest;
    const app = middlewareApp({
      manifest: [HELLO_HANDLER],
      modules: new Map([
        [
          ROOT_MIDDLEWARE,
          {
            default: [
              (req, res) => {
                middlewareRequest = req;
                req.trace = ["root:first"];
                res.headers({ "x-root": "yes" });
              },
              (req) => {
                req.trace.push("root:second");
              },
            ],
          },
        ],
        [
          HELLO_MIDDLEWARE,
          {
            default: (req, res) => {
              req.trace.push("hello");
              res.headers({ "x-hello": "yes" });
            },
          },
        ],
        [
          "hello",
          {
            GET: (req, res) => {
              handlerRequest = req;
              req.trace.push("handler");
              return res.json({ trace: req.trace });
            },
          },
        ],
      ]),
      middlewareByRoute: new Map([
        [
          "hello",
          [descriptor(ROOT_MIDDLEWARE), descriptor(HELLO_MIDDLEWARE)],
        ],
      ]),
    });

    const response = await dispatch(app, get("/hello"));

    expect(middlewareRequest).toBe(handlerRequest);
    expect(response.headers.get("x-root")).toBe("yes");
    expect(response.headers.get("x-hello")).toBe("yes");
    expect(await response.json()).toEqual({
      trace: ["root:first", "root:second", "hello", "handler"],
    });
  });

  it("short-circuits before the handler when middleware returns a response intent", async () => {
    const handler = vi.fn((req, res) => res.text("handler"));
    const app = middlewareApp({
      manifest: [HELLO_HANDLER],
      modules: new Map([
        [ROOT_MIDDLEWARE, { default: (req, res) => res.redirect("/login") }],
        ["hello", { GET: handler }],
      ]),
      middlewareByRoute: new Map([
        ["hello", [descriptor(ROOT_MIDDLEWARE)]],
      ]),
    });

    const response = await dispatch(app, get("/hello"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
    expect(handler).not.toHaveBeenCalled();
  });

  it("continues through undefined middleware and renders an implicit page with accumulated response state", async () => {
    const middleware = vi.fn((req, res) => {
      res.status(202).headers({ "x-middleware-page": "yes" });
    });
    const Page = vi.fn(() => h("h1", null, "Page after middleware"));
    const app = middlewareApp({
      manifest: [INDEX],
      modules: new Map([
        [ROOT_MIDDLEWARE, { default: middleware }],
        ["index", { default: Page }],
      ]),
      middlewareByRoute: new Map([
        ["index", [descriptor(ROOT_MIDDLEWARE)]],
      ]),
    });

    const response = await dispatch(app, get("/"));

    expect(middleware).toHaveBeenCalledTimes(1);
    expect(Page).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(202);
    expect(response.headers.get("x-middleware-page")).toBe("yes");
    expect(await response.text()).toContain("<h1>Page after middleware</h1>");
  });

  it("preserves middleware status, headers, and cookies for automatic HEAD targeting a page", async () => {
    const Page = vi.fn(() => h("h1", null, "HEAD page"));
    const app = middlewareApp({
      manifest: [INDEX],
      modules: new Map([
        [
          ROOT_MIDDLEWARE,
          {
            default: (req, res) => {
              req.cookies.set("head-page", "yes");
              res.status(202).headers({ "x-head-page": "yes" });
            },
          },
        ],
        ["index", { default: Page }],
      ]),
      middlewareByRoute: new Map([
        ["index", [descriptor(ROOT_MIDDLEWARE)]],
      ]),
    });

    const response = await dispatch(
      app,
      new Request("https://example.com/", { method: "HEAD" }),
    );

    expect(Page).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(202);
    expect(response.headers.get("x-head-page")).toBe("yes");
    expect(response.headers.get("set-cookie")).toBe("head-page=yes");
    expect(await response.text()).toBe("");
  });

  it("lets middleware replace a page with a response intent", async () => {
    const Page = vi.fn(() => h("h1", null, "Never rendered"));
    const app = middlewareApp({
      manifest: [INDEX],
      modules: new Map([
        [ROOT_MIDDLEWARE, { default: (req, res) => res.text("replaced") }],
        ["index", { default: Page }],
      ]),
      middlewareByRoute: new Map([
        ["index", [descriptor(ROOT_MIDDLEWARE)]],
      ]),
    });

    const response = await dispatch(app, get("/"));

    expect(await response.text()).toBe("replaced");
    expect(Page).not.toHaveBeenCalled();
  });

  it("flushes cookies queued by middleware onto the final response", async () => {
    const app = middlewareApp({
      manifest: [HELLO_HANDLER],
      modules: new Map([
        [
          ROOT_MIDDLEWARE,
          {
            default: (req) => {
              req.cookies.set("from-middleware", "yes", { httpOnly: true });
            },
          },
        ],
        ["hello", { GET: (req, res) => res.json({ ok: true }) }],
      ]),
      middlewareByRoute: new Map([
        ["hello", [descriptor(ROOT_MIDDLEWARE)]],
      ]),
    });

    const response = await dispatch(app, get("/hello"));

    expect(response.headers.get("set-cookie")).toBe(
      "from-middleware=yes; HttpOnly",
    );
  });

  it.each([
    [
      "a raw Web Response",
      function rawResponseMiddleware() {
        return new Response("raw");
      },
      '[Goribu] Middleware "rawResponseMiddleware" at index 0 returned a Web Response. Return a res.* result instead so Goribu can apply cookies and other framework behavior. Use res.text(), res.json(), res.invalid(), res.redirect(), res.render(), or res.notFound().',
    ],
    [
      "a non-response value",
      function nonResponseMiddleware() {
        return "wrong";
      },
      '[Goribu] Middleware "nonResponseMiddleware" at index 0 returned a non-response value. Return nothing to continue, or return a res.* result such as res.redirect(\'/login\') to stop the chain.',
    ],
  ])("discloses middleware returning %s as a teaching 500", async (label, result, message) => {
    const app = middlewareApp({
      manifest: [HELLO_HANDLER],
      mode: "development",
      modules: new Map([
        [ROOT_MIDDLEWARE, { default: result }],
        ["hello", { GET: (req, res) => res.text("handler") }],
      ]),
      middlewareByRoute: new Map([
        ["hello", [descriptor(ROOT_MIDDLEWARE)]],
      ]),
    });

    await expect(developmentErrorBody(app, get("/hello"))).resolves.toContain(
      message,
    );
  });

  it("runs target middleware for automatic HEAD and preserves its cookies", async () => {
    const middleware = vi.fn((req) => req.cookies.set("head", "yes"));
    const handler = vi.fn((req, res) => res.text("GET body"));
    const app = middlewareApp({
      manifest: [HELLO_HANDLER],
      modules: new Map([
        [ROOT_MIDDLEWARE, { default: middleware }],
        ["hello", { GET: handler }],
      ]),
      middlewareByRoute: new Map([
        ["hello", [descriptor(ROOT_MIDDLEWARE)]],
      ]),
    });

    const response = await dispatch(
      app,
      new Request("https://example.com/hello", { method: "HEAD" }),
    );

    expect(middleware).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.headers.get("set-cookie")).toBe("head=yes");
    expect(await response.text()).toBe("");
  });

  it("does not run middleware for automatic OPTIONS, 405, or a route miss", async () => {
    const middleware = vi.fn();
    const app = middlewareApp({
      manifest: [HELLO_HANDLER],
      modules: new Map([
        [ROOT_MIDDLEWARE, { default: middleware }],
        ["hello", { GET: (req, res) => res.text("handler") }],
      ]),
      middlewareByRoute: new Map([
        ["hello", [descriptor(ROOT_MIDDLEWARE)]],
      ]),
    });

    await dispatch(app, new Request("https://example.com/hello", { method: "OPTIONS" }));
    await dispatch(app, new Request("https://example.com/hello", { method: "PUT" }));
    await dispatch(app, get("/missing"));

    expect(middleware).not.toHaveBeenCalled();
  });

  it("keeps a route with no selected middleware on its existing page path", async () => {
    const middleware = vi.fn();
    const Page = vi.fn(() => h("h1", null, "No middleware"));
    const app = middlewareApp({
      manifest: [INDEX, HELLO_HANDLER],
      modules: new Map([
        [HELLO_MIDDLEWARE, { default: middleware }],
        ["index", { default: Page }],
        ["hello", { GET: (req, res) => res.text("handler") }],
      ]),
      middlewareByRoute: new Map([
        ["hello", [descriptor(HELLO_MIDDLEWARE)]],
      ]),
    });

    const response = await dispatch(app, get("/"));

    expect(middleware).not.toHaveBeenCalled();
    expect(Page).toHaveBeenCalledTimes(1);
    expect(await response.text()).toContain("<h1>No middleware</h1>");
  });
});

describe("createApp().fetch — named handlers", () => {
  function handlerApp(modules, overrides = {}) {
    return createApp({
      manifest: [HELLO_HANDLER, ITEM_HANDLER, MIXED],
      modules,
      errorPages: { notFound: null },
      documentId: null,
      ...overrides,
    });
  }

  const post = (path) =>
    new Request(`https://example.com${path}`, { method: "POST" });

  it("dispatches a GET handler and finalizes res.json()", async () => {
    const app = handlerApp(
      new Map([["hello", { GET: (req, res) => res.json({ ok: true, method: req.method }) }]]),
    );
    const response = await dispatch(app, get("/hello"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual({ ok: true, method: "GET" });
  });

  it("finalizes res.redirect() as a 303 to the location with no body", async () => {
    const app = handlerApp(
      new Map([["hello", { POST: (req, res) => res.redirect("/") }]]),
    );
    const response = await dispatch(app, post("/hello"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(await response.text()).toBe("");
  });

  it("passes dynamic route params to the handler", async () => {
    const app = handlerApp(
      new Map([["item", { GET: (req, res) => res.json({ id: req.params.id }) }]]),
    );
    expect(await (await dispatch(app, get("/items/42"))).json()).toEqual({ id: "42" });
  });

  it("gives the handler the request surface: query and headers", async () => {
    const app = handlerApp(
      new Map([
        [
          "hello",
          {
            GET: (req, res) =>
              res.json({ q: req.query.get("q"), id: req.headers.get("x-request-id") }),
          },
        ],
      ]),
    );
    const response = await dispatch(
      app,
      new Request("https://example.com/hello?q=hi", { headers: { "x-request-id": "abc" } }),
    );
    expect(await response.json()).toEqual({ q: "hi", id: "abc" });
  });

  it("flushes cookies queued by a handler onto its final response", async () => {
    const app = handlerApp(
      new Map([
        [
          "hello",
          {
            GET: (req, res) => {
              req.cookies.set("session", "abc", { httpOnly: true });
              return res.json({ ok: true });
            },
          },
        ],
      ]),
    );
    const response = await dispatch(app, get("/hello"));

    expect(response.headers.get("set-cookie")).toBe("session=abc; HttpOnly");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("lets a handler read an incoming cookie", async () => {
    const app = handlerApp(
      new Map([
        [
          "hello",
          { GET: (req, res) => res.json({ theme: req.cookies.get("theme") }) },
        ],
      ]),
    );
    const response = await dispatch(
      app,
      new Request("https://example.com/hello", {
        headers: { cookie: "theme=dark" },
      }),
    );

    expect(await response.json()).toEqual({ theme: "dark" });
  });

  it("keeps Set-Cookie on an automatic HEAD response while dropping the body", async () => {
    const app = handlerApp(
      new Map([
        [
          "hello",
          {
            GET: (req, res) => {
              req.cookies.set("session", "abc", { httpOnly: true });
              return res.json({ ok: true });
            },
          },
        ],
      ]),
    );
    const response = await dispatch(
      app,
      new Request("https://example.com/hello", { method: "HEAD" }),
    );

    expect(response.headers.get("set-cookie")).toBe("session=abc; HttpOnly");
    expect(await response.text()).toBe("");
  });

  it("does not add Set-Cookie when no handler runs", async () => {
    const app = handlerApp(
      new Map([
        [
          "hello",
          {
            GET: (req, res) => {
              req.cookies.set("unexpected", "yes");
              return res.json({ ok: true });
            },
          },
        ],
      ]),
    );

    const responses = await Promise.all([
      dispatch(app, new Request("https://example.com/hello", { method: "OPTIONS" })),
      dispatch(app, new Request("https://example.com/hello", { method: "PUT" })),
      dispatch(app, get("/hello/")),
    ]);

    expect(responses.map((response) => response.headers.get("set-cookie"))).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("parses a POSTed JSON body through req.body()", async () => {
    const app = handlerApp(
      new Map([["hello", { POST: async (req, res) => res.json(await req.body()) }]]),
    );
    const response = await dispatch(
      app,
      new Request("https://example.com/hello", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "hi" }),
      }),
    );
    expect(await response.json()).toEqual({ title: "hi" });
  });

  it("answers automatic HEAD by running the GET handler and dropping the body", async () => {
    const app = handlerApp(
      new Map([["hello", { GET: (req, res) => res.json({ ok: true }) }]]),
    );
    const response = await dispatch(
      app,
      new Request("https://example.com/hello", { method: "HEAD" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await response.text()).toBe("");
  });

  it("runs an explicit GET handler instead of the route's default page", async () => {
    const app = handlerApp(
      new Map([
        ["mixed", { default: () => h("h1", null, "Page"), GET: (req, res) => res.text("handler wins") }],
      ]),
    );
    const response = await dispatch(app, get("/mixed"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe("handler wins");
  });

  it("streams the route's own page when a GET handler returns res.render(props)", async () => {
    const app = handlerApp(
      new Map([
        [
          "mixed",
          {
            default: ({ title }) => h("h1", null, title),
            GET: (req, res) => res.render({ title: `Hello ${req.query.get("name")}` }),
          },
        ],
      ]),
    );
    const response = await dispatch(app, get("/mixed?name=Goribu"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(body).toContain("<h1>Hello Goribu</h1>");
  });

  it("carries a chained status and headers through res.render()", async () => {
    const app = handlerApp(
      new Map([
        [
          "mixed",
          {
            default: () => h("p", null, "Created"),
            GET: (req, res) =>
              res.status(201).headers({ "x-created": "yes" }).render({}),
          },
        ],
      ]),
    );
    const response = await dispatch(app, get("/mixed"));

    expect(response.status).toBe(201);
    expect(response.headers.get("x-created")).toBe("yes");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("<p>Created</p>");
  });

  it("lets res.render() override the content type but keeps the HTML default for an empty array", async () => {
    const build = (headers) =>
      handlerApp(
        new Map([
          [
            "mixed",
            {
              default: () => h("p", null, "x"),
              GET: (req, res) => res.headers(headers).render({}),
            },
          ],
        ]),
      );

    const overridden = await dispatch(
      build({ "content-type": "text/html; charset=iso-8859-1" }),
      get("/mixed"),
    );
    expect(overridden.headers.get("content-type")).toBe("text/html; charset=iso-8859-1");

    const cleared = await dispatch(build({ "content-type": [] }), get("/mixed"));
    expect(cleared.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("renders the built-in _404 page with a 404 status for res.notFound()", async () => {
    const app = handlerApp(
      new Map([["hello", { GET: (req, res) => res.notFound() }]]),
    );
    const response = await dispatch(app, get("/hello"));

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("could not be found");
  });

  it("renders a discovered _404 page for res.notFound(), passing props", async () => {
    const app = createApp({
      manifest: [HELLO_HANDLER, ITEM_HANDLER, MIXED],
      modules: new Map([
        ["hello", { GET: (req, res) => res.notFound({ reason: "no such item" }) }],
        ["notfound", { default: ({ reason }) => h("h1", null, `Missing: ${reason ?? "?"}`) }],
      ]),
      errorPages: { notFound: "notfound" },
      documentId: null,
    });
    const response = await dispatch(app, get("/hello"));

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("<h1>Missing: no such item</h1>");
  });

  it("discloses the teaching error when res.render() uses a bodyless status", async () => {
    const app = handlerApp(
      new Map([
        ["mixed", { default: () => h("p", null, "x"), GET: (req, res) => res.status(204).render({}) }],
      ]),
      { mode: "development" },
    );
    await expect(developmentErrorBody(app, get("/mixed"))).resolves.toContain(
      "[Goribu] Cannot render a page with status 204 because that status cannot carry a response body. Choose a body-bearing status before calling res.render(props).",
    );
  });

  it("discloses the teaching error when a page-less handler calls res.render()", async () => {
    const app = handlerApp(
      new Map([["hello", { GET: (req, res) => res.render({}) }]]),
      { mode: "development" },
    );
    await expect(developmentErrorBody(app, get("/hello"))).resolves.toContain(
      "[Goribu] res.render(props) requires the matched route to have a default page export. Add a default export to the route or return res.text(), res.json(), res.invalid(), res.redirect(), or res.notFound().",
    );
  });

  it("discloses the teaching error when a handler returns nothing", async () => {
    const app = handlerApp(
      new Map([["hello", { GET: () => {} }]]),
      { mode: "development" },
    );
    await expect(developmentErrorBody(app, get("/hello"))).resolves.toContain(
      "[Goribu] The GET handler for route \"hello\" did not return a response. Return a res.* result such as res.json(), res.text(), or res.redirect().",
    );
  });

  it("discloses the teaching error when a handler returns a raw Web Response", async () => {
    const app = handlerApp(
      new Map([["hello", { GET: () => new Response("no") }]]),
      { mode: "development" },
    );
    await expect(developmentErrorBody(app, get("/hello"))).resolves.toContain(
      "[Goribu] The GET handler for route \"hello\" returned a Web Response. Return a res.* result instead so Goribu can apply framework behavior.",
    );
  });

  it("discloses the teaching error when a handler returns a non-response value", async () => {
    const app = handlerApp(
      new Map([["hello", { GET: () => "just a string" }]]),
      { mode: "development" },
    );
    await expect(developmentErrorBody(app, get("/hello"))).resolves.toContain(
      "[Goribu] The GET handler for route \"hello\" returned a non-response value. Return a genuine res.* result instead of a string, the response builder, or a plain object.",
    );
  });
});
