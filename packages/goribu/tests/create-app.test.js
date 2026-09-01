import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
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
