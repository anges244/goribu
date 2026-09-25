import { createElement as h } from "react";
import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../src/runtime/create-app.js";
import { defineConfig } from "goribu/server";

const ray = "8fa123456789abcd-ATH";
const route = {
  id: "action",
  pattern: "/action",
  segments: [{ type: "static", value: "action" }],
  methods: ["GET", "POST"],
  hasDefaultExport: false,
};
const ctx = { waitUntil() {} };

afterEach(() => vi.restoreAllMocks());

function app(handler, extra = {}) {
  return createApp({
    manifest: [route],
    modules: new Map([["action", { GET: handler, POST: handler }]]),
    mode: "production",
    errorPages: { notFound: null, serverError: null },
    documentId: null,
    applicationConfig: defineConfig({
      name: "error-pages-test",
      compatibilityDate: "2026-08-31",
      responseHeaders: ({ nonce }) => ({
        "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'`,
        "cache-control": "public, max-age=3600",
      }),
    }),
    ...extra,
  });
}

function request(path, method = "GET", cfRay = ray) {
  return new Request(`https://example.com${path}`, {
    method,
    headers: { "cf-ray": cfRay },
  });
}

it("streams self-styled route-miss and handler 404s with safe request details and the CSP nonce", async () => {
  const application = app((req, res) =>
    res.headers({ "x-app": "kept" }).notFound({ secret: "private-props" }),
  );
  for (const path of [
    "/missing?token=secret-query",
    "/action?token=secret-query",
  ]) {
    const response = await application.fetch(request(path), {}, ctx);
    expect(response.status).toBe(404);
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(response.bodyUsed).toBe(false);
    expect(response.headers.get("cache-control")).toBe("no-store");
    if (path.startsWith("/action"))
      expect(response.headers.get("x-app")).toBe("kept");
    const html = await response.text();
    const dom = new JSDOM(html);
    try {
      const doc = dom.window.document;
      expect(doc.title).toBe("Page not found");
      expect(doc.querySelector('meta[name="viewport"]').content).toContain(
        "width=device-width",
      );
      expect(doc.querySelector("h1").textContent).toBe("Page not found.");
      expect(doc.querySelector("dl").textContent).toContain(ray);
      expect(doc.querySelector("a").getAttribute("href")).toBe("/");
      expect(response.headers.get("content-security-policy")).toContain(
        `'nonce-${doc.querySelector("style").nonce}'`,
      );
      expect(doc.querySelector("style").nonce).not.toBe("");
      expect(doc.querySelector("style").textContent).toContain(
        "prefers-color-scheme: dark",
      );
      expect(html).not.toMatch(
        /secret-query|private-props|javascript:|onclick=/,
      );
    } finally {
      dom.window.close();
    }
  }
});

it("uses real 500 diagnostics in the page and logs, without exposing secrets or replaying POST", async () => {
  const error = new Error("database-password");
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const application = app((req) => {
    req.cookies.set("failed", "yes");
    throw error;
  });
  const response = await application.fetch(
    request("/action?token=secret-query", "POST"),
    {},
    ctx,
  );
  const html = await response.text();
  const dom = new JSDOM(html);
  try {
    const doc = dom.window.document;
    const props = JSON.parse(
      doc.getElementById("__GORIBU_PROPS__").textContent,
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toContain("failed=yes");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(doc.title).toBe("Something went wrong");
    expect(props).toEqual({
      url: "/action",
      errorId: expect.any(String),
      cfRay: ray,
    });
    expect(doc.querySelector("dl").textContent).toContain(props.errorId);
    expect(doc.querySelector("dl").textContent).toContain(ray);
    expect(doc.querySelector("a").href).toBe("https://example.com/action?token=secret-query");
    expect(doc.querySelector("form")).toBeNull();
    expect(logged).toHaveBeenCalledWith(
      `[Goribu] Unhandled error ${props.errorId} (CF-Ray: ${ray}):`,
      error,
    );
    expect(doc.body.textContent).not.toContain("secret-query");
    expect(html).not.toMatch(/database-password|javascript:|onclick=/);
  } finally {
    dom.window.close();
  }
  const head = await application.fetch(request("/action", "HEAD"), {}, ctx);
  expect(head.status).toBe(500);
  expect(await head.text()).toBe("");
});

it("retains a request nonce when middleware returns 404 from an otherwise static page", async () => {
  const application = app(null, {
    manifest: [
      { ...route, methods: [], hasDefaultExport: true, staticCandidate: true },
    ],
    modules: new Map([
      ["action", { default: () => h("h1", null, "Page") }],
      ["middleware", { default: (req, res) => res.notFound() }],
    ]),
    middlewareByRoute: new Map([
      ["action", [{ id: "middleware", relativePath: "_middleware.js" }]],
    ]),
  });
  const response = await application.fetch(request("/action"), {}, ctx);
  expect(response.status).toBe(404);
  const nonce = /'nonce-([^']+)'/.exec(
    response.headers.get("content-security-policy"),
  )[1];
  expect(await response.text()).toContain(`<style nonce="${nonce}">`);
});

it("retries the failed request with GET independently of the Document base", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const failedUrl = "https://example.com/action?token=keep&next=%2Faccount#section";
  for (const base of ["/app/", "https://assets.example.net/app/"]) {
    const methods = [];
    const handler = (req, res) => {
      methods.push(req.method);
      if (req.method === "POST") throw new Error("private");
      return res.json({ recovered: true });
    };
    const application = app(handler, {
      documentId: "document",
      modules: new Map([
        ["action", { GET: handler, POST: handler }],
        ["document", { default: ({ children, head }) => h("html", null,
          h("head", null, h("base", { href: base }), head),
          h("body", null, children),
        ) }],
      ]),
    });
    const response = await application.fetch(new Request(failedUrl, { method: "POST" }), {}, ctx);
    expect(response.status).toBe(500);
    const dom = new JSDOM(await response.text(), { url: failedUrl });
    try {
      const doc = dom.window.document;
      const retry = doc.querySelector(".ge-primary");
      expect(retry.href).toBe("https://example.com/action?token=keep&next=%2Faccount");
      expect(doc.querySelector("dl").textContent).not.toContain("token=");
      const recovered = await application.fetch(new Request(retry.href), {}, ctx);
      expect(await recovered.json()).toEqual({ recovered: true });
      expect(methods).toEqual(["POST", "GET"]);
    } finally {
      dom.window.close();
    }
  }
});

it("keeps custom 404 props intact and passes the optional Ray ID to custom 500 pages and metadata", async () => {
  const supplied = {
    url: "app-owned",
    cfRay: "app-owned",
    message: "Missing item",
  };
  let missingProps, errorProps, metaProps;
  const missing = (req, res) => res.notFound(supplied);
  const application = app(missing, {
    modules: new Map([
      [
        "action",
        {
          GET: missing,
          POST() {
            throw new Error("private");
          },
        },
      ],
      [
        "404",
        {
          default: (props) => {
            missingProps = props;
            return h("h1", null, props.message);
          },
        },
      ],
      [
        "500",
        {
          default: (props) => {
            errorProps = props;
            return h("h1", null, props.errorId);
          },
          meta: ({ props }) => {
            metaProps = props;
            return { title: "Custom failure" };
          },
        },
      ],
    ]),
    errorPages: { notFound: "404", serverError: "500" },
  });
  const notFoundHtml = await (
    await application.fetch(request("/action"), {}, ctx)
  ).text();
  expect(missingProps).toEqual(supplied);
  expect(notFoundHtml).not.toContain("goribu-error");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const serverHtml = await (
    await application.fetch(request("/action?token=custom-private", "POST"), {}, ctx)
  ).text();
  expect(errorProps).toEqual({
    url: "/action",
    errorId: expect.any(String),
    cfRay: ray,
  });
  expect(metaProps).toEqual(errorProps);
  expect(serverHtml).not.toContain("goribu-error");
  expect(serverHtml).not.toContain("custom-private");
});

it("omits unavailable or malformed Ray IDs and preserves the ID in the last-resort fallback", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const application = app(() => {
    throw new Error("private");
  });
  for (const value of ["", "<script>bad</script>", "x".repeat(129)]) {
    for (const path of ["/missing", "/action"]) {
      const response = await application.fetch(
        request(path, "GET", value),
        {},
        ctx,
      );
      expect(await response.text()).not.toContain("Cloudflare Ray ID");
    }
  }
  const broken = app(
    () => {
      throw new Error("private");
    },
    {
      documentId: "document",
      modules: new Map([
        [
          "action",
          {
            GET() {
              throw new Error("private");
            },
          },
        ],
        [
          "document",
          {
            default() {
              throw new Error("broken shell");
            },
          },
        ],
      ]),
    },
  );
  const response = await broken.fetch(request("/action"), {}, ctx);
  expect(response.status).toBe(500);
  expect(response.headers.get("content-type")).toContain("text/plain");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toMatch(
    new RegExp(
      `^Internal Server Error\\nError ID: .+\\nCloudflare Ray ID: ${ray}$`,
    ),
  );
});
