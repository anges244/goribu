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

describe("createApp().fetch", () => {
  it("renders a matched page as a streamed HTML document", async () => {
    const response = await build().fetch(get("/"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    // The default document owns html/head/body and the hydration root.
    expect(body).toContain("<html>");
    expect(body).toContain('<div id="root">');
    expect(body).toContain("<h1>Home</h1>");
  });

  it("matches a dynamic segment and renders the same page for any value", async () => {
    const response = await build().fetch(get("/posts/hello-world"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<h1>A post</h1>");
  });

  it("redirects a trailing slash to the canonical path with 308", async () => {
    const response = await build().fetch(get("/about/"));
    expect(response.status).toBe(308);
    expect(new URL(response.headers.get("location")).pathname).toBe("/about");
  });

  it("drops repeated trailing slashes and preserves the query in one redirect", async () => {
    const response = await build().fetch(get("/posts/hello//?page=2"));
    expect(response.status).toBe(308);
    const location = new URL(response.headers.get("location"));
    expect(location.pathname).toBe("/posts/hello");
    expect(location.search).toBe("?page=2");
  });

  it("does not redirect the root path", async () => {
    expect((await build().fetch(get("/"))).status).toBe(200);
  });

  it("streams the built-in 404 page when no route matches", async () => {
    const response = await build().fetch(get("/missing"));
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
    const response = await app.fetch(get("/missing"));
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
    const body = await (await app.fetch(get("/"))).text();
    expect(body).toContain('data-custom=""');
    expect(body).toContain("<h1>Home</h1>");
  });

  it("answers HEAD with the page status and no body", async () => {
    const response = await build().fetch(new Request("https://example.com/", { method: "HEAD" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("answers HEAD for an unmatched route with a 404 status and no body", async () => {
    const response = await build().fetch(
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
    const response = await app.fetch(
      new Request("https://example.com/missing", { method: "HEAD" }),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("answers automatic OPTIONS with 204 and an Allow header", async () => {
    const response = await build().fetch(new Request("https://example.com/", { method: "OPTIONS" }));
    expect(response.status).toBe(204);
    expect(response.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
  });

  it("answers an unsupported method with 405 and an Allow header", async () => {
    const response = await build().fetch(new Request("https://example.com/", { method: "POST" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
  });

  it("fails closed when a matched route module has no default export", async () => {
    const app = build({
      modules: new Map([
        ["index", {}],
        ["about", pageModule("About")],
        ["post", pageModule("A post")],
      ]),
    });
    await expect(app.fetch(get("/"))).rejects.toThrow(/no default-exported React component/);
  });
});

describe("createApp().fetch — middleware", () => {
  const ROOT_MIDDLEWARE = "src/routes/_middleware.js";
  const HELLO_MIDDLEWARE = "src/routes/hello/_middleware.js";

  function descriptor(id) {
    return { id, relativePath: id.replace("src/routes/", "") };
  }

  function middlewareApp({ manifest, modules, middlewareByRoute }) {
    return createApp({
      manifest,
      modules,
      errorPages: { notFound: null },
      documentId: null,
      middlewareByRoute,
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

    const response = await app.fetch(get("/hello"));

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

    const response = await app.fetch(get("/hello"));

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

    const response = await app.fetch(get("/"));

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

    const response = await app.fetch(
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

    const response = await app.fetch(get("/"));

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

    const response = await app.fetch(get("/hello"));

    expect(response.headers.get("set-cookie")).toBe(
      "from-middleware=yes; HttpOnly",
    );
  });

  it.each([
    ["a raw Web Response", () => new Response("raw"), "returned a Web Response"],
    ["a non-response value", () => "wrong", "returned a non-response value"],
  ])("rejects middleware returning %s with a teaching error", async (label, result, message) => {
    const app = middlewareApp({
      manifest: [HELLO_HANDLER],
      modules: new Map([
        [ROOT_MIDDLEWARE, { default: result }],
        ["hello", { GET: (req, res) => res.text("handler") }],
      ]),
      middlewareByRoute: new Map([
        ["hello", [descriptor(ROOT_MIDDLEWARE)]],
      ]),
    });

    await expect(app.fetch(get("/hello"))).rejects.toThrow(message);
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

    const response = await app.fetch(
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

    await app.fetch(new Request("https://example.com/hello", { method: "OPTIONS" }));
    await app.fetch(new Request("https://example.com/hello", { method: "PUT" }));
    await app.fetch(get("/missing"));

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

    const response = await app.fetch(get("/"));

    expect(middleware).not.toHaveBeenCalled();
    expect(Page).toHaveBeenCalledTimes(1);
    expect(await response.text()).toContain("<h1>No middleware</h1>");
  });
});

describe("createApp().fetch — named handlers", () => {
  function handlerApp(modules) {
    return createApp({
      manifest: [HELLO_HANDLER, ITEM_HANDLER, MIXED],
      modules,
      errorPages: { notFound: null },
      documentId: null,
    });
  }

  const post = (path) =>
    new Request(`https://example.com${path}`, { method: "POST" });

  it("dispatches a GET handler and finalizes res.json()", async () => {
    const app = handlerApp(
      new Map([["hello", { GET: (req, res) => res.json({ ok: true, method: req.method }) }]]),
    );
    const response = await app.fetch(get("/hello"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual({ ok: true, method: "GET" });
  });

  it("finalizes res.redirect() as a 303 to the location with no body", async () => {
    const app = handlerApp(
      new Map([["hello", { POST: (req, res) => res.redirect("/") }]]),
    );
    const response = await app.fetch(post("/hello"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(await response.text()).toBe("");
  });

  it("passes dynamic route params to the handler", async () => {
    const app = handlerApp(
      new Map([["item", { GET: (req, res) => res.json({ id: req.params.id }) }]]),
    );
    expect(await (await app.fetch(get("/items/42"))).json()).toEqual({ id: "42" });
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
    const response = await app.fetch(
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
    const response = await app.fetch(get("/hello"));

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
    const response = await app.fetch(
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
    const response = await app.fetch(
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
      app.fetch(new Request("https://example.com/hello", { method: "OPTIONS" })),
      app.fetch(new Request("https://example.com/hello", { method: "PUT" })),
      app.fetch(get("/hello/")),
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
    const response = await app.fetch(
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
    const response = await app.fetch(
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
    const response = await app.fetch(get("/mixed"));

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
    const response = await app.fetch(get("/mixed?name=Goribu"));
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
    const response = await app.fetch(get("/mixed"));

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

    const overridden = await build({ "content-type": "text/html; charset=iso-8859-1" }).fetch(
      get("/mixed"),
    );
    expect(overridden.headers.get("content-type")).toBe("text/html; charset=iso-8859-1");

    const cleared = await build({ "content-type": [] }).fetch(get("/mixed"));
    expect(cleared.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("renders the built-in _404 page with a 404 status for res.notFound()", async () => {
    const app = handlerApp(
      new Map([["hello", { GET: (req, res) => res.notFound() }]]),
    );
    const response = await app.fetch(get("/hello"));

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
    const response = await app.fetch(get("/hello"));

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("<h1>Missing: no such item</h1>");
  });

  it("teaches when res.render() is used with a bodyless status", async () => {
    const app = handlerApp(
      new Map([
        ["mixed", { default: () => h("p", null, "x"), GET: (req, res) => res.status(204).render({}) }],
      ]),
    );
    await expect(app.fetch(get("/mixed"))).rejects.toThrow(
      /status 204 because that status cannot carry a response body/,
    );
  });

  it("teaches when a handler on a page-less route calls res.render()", async () => {
    const app = handlerApp(
      new Map([["hello", { GET: (req, res) => res.render({}) }]]),
    );
    await expect(app.fetch(get("/hello"))).rejects.toThrow(
      /requires the matched route to have a default page export/,
    );
  });

  it("teaches when a handler returns nothing", async () => {
    const app = handlerApp(new Map([["hello", { GET: () => {} }]]));
    await expect(app.fetch(get("/hello"))).rejects.toThrow(/did not return a response/);
  });

  it("teaches when a handler returns a raw Web Response", async () => {
    const app = handlerApp(new Map([["hello", { GET: () => new Response("no") }]]));
    await expect(app.fetch(get("/hello"))).rejects.toThrow(/returned a Web Response/);
  });

  it("teaches when a handler returns a non-response value", async () => {
    const app = handlerApp(new Map([["hello", { GET: () => "just a string" }]]));
    await expect(app.fetch(get("/hello"))).rejects.toThrow(/non-response value/);
  });
});
