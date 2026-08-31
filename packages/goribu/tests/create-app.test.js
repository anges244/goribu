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
