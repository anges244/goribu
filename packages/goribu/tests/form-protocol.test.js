import { createElement as h } from "react";
import { describe, expect, it, vi } from "vitest";
import { createApp, defineConfig } from "goribu/server";
import {
  FORM_MEDIA_TYPE,
  hasFormMediaType,
} from "../src/forms/form-protocol.js";

const FEEDBACK_ID = "src/routes/feedback.jsx";
const SAVE_ID = "src/routes/save.js";
const CROSS_ID = "src/routes/cross.jsx";
const PLAIN_ID = "src/routes/plain.js";

const routes = [
  route({
    id: FEEDBACK_ID,
    pattern: "/feedback",
    segments: [{ type: "static", value: "feedback" }],
    hasDefaultExport: true,
    methods: ["POST"],
  }),
  route({
    id: SAVE_ID,
    pattern: "/save",
    segments: [{ type: "static", value: "save" }],
    methods: ["GET", "POST"],
  }),
  route({
    id: CROSS_ID,
    pattern: "/cross",
    segments: [{ type: "static", value: "cross" }],
    hasDefaultExport: true,
    methods: ["POST"],
  }),
  route({
    id: PLAIN_ID,
    pattern: "/plain",
    segments: [{ type: "static", value: "plain" }],
    methods: ["POST"],
  }),
];

function FeedbackPage({ message = "", preview = false } = {}) {
  return h("main", null, preview ? `preview:${message}` : "feedback");
}

function createFormApp(options = {}) {
  return createApp({
    manifest: routes,
    errorPages: { notFound: null, serverError: null },
    documentId: null,
    modules: new Map([
      [
        FEEDBACK_ID,
        {
          default: FeedbackPage,
          meta: ({ props, url }) => ({
            title: props.preview ? `Preview: ${props.message}` : "Feedback",
            canonical: url.href,
          }),
          async POST(request, response) {
            const body = await request.body();
            const messageValue =
              body instanceof FormData ? body.get("message") : body.message;
            const intentValue =
              body instanceof FormData ? body.get("intent") : body.intent;
            const message =
              typeof messageValue === "string" ? messageValue.trim() : "";
            const intent = typeof intentValue === "string" ? intentValue : "send";
            if (intent === "warn") {
              return response.invalid({ message: 123 });
            }
            if (message.length === 0) {
              return response.invalid({ message: "Enter a message before sending." });
            }
            if (intent === "preview") {
              return response.render({ message, preview: true });
            }
            request.cookies.set("last_feedback", "received", {
              path: "/feedback",
              httpOnly: true,
              sameSite: "Lax",
            });
            return response.redirect("/feedback/thanks");
          },
        },
      ],
      [
        SAVE_ID,
        {
          GET(request, response) {
            return response.json({ loaded: true });
          },
          POST(request, response) {
            return response
              .status(201)
              .headers({
                "content-encoding": "gzip",
                "content-length": "10",
                etag: '"representation"',
                vary: "Origin",
                "x-route-header": "kept",
              })
              .json({ saved: true });
          },
        },
      ],
      [
        CROSS_ID,
        {
          default: () => h("main", null, "Cross"),
          POST(request, response) {
            return response.render({ ok: true });
          },
        },
      ],
      [
        PLAIN_ID,
        {
          POST(request, response) {
            return response.headers({ vary: "*" }).text("plain");
          },
        },
      ],
    ]),
    mode: options.mode ?? "production",
    applicationConfig: options.applicationConfig,
  });
}

function formRequest(
  app,
  path,
  {
    body,
    referer,
    accept = FORM_MEDIA_TYPE,
    headers: extraHeaders,
    env,
    ctx,
    ...init
  } = {},
) {
  const headers = new Headers(extraHeaders);
  if (accept !== null) headers.set("accept", accept);
  if (referer !== undefined) headers.set("referer", referer);
  return app.fetch(
    new Request(`https://example.com${path}`, {
      method: "POST",
      headers,
      body,
      ...init,
    }),
    env ?? {},
    ctx ?? { waitUntil() {} },
  );
}

function urlencoded(fields) {
  const params = new URLSearchParams(fields);
  return {
    body: params.toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  };
}

function multipart(fields) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return { body };
}

describe("form media type matching", () => {
  it("accepts the bare and parameterized form response Content-Type", () => {
    expect(hasFormMediaType(FORM_MEDIA_TYPE)).toBe(true);
    expect(hasFormMediaType(`${FORM_MEDIA_TYPE}; charset=utf-8`)).toBe(true);
  });
});

describe("enhanced form negotiation", () => {
  it("negotiates a JSON envelope by Accept and marks it framework-owned", async () => {
    const app = createFormApp();
    const response = await formRequest(app, "/save", urlencoded({ ok: "1" }));

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe(FORM_MEDIA_TYPE);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Origin, Accept");
    expect(response.headers.get("x-route-header")).toBe("kept");
    // Representation headers are stripped from the negotiated JSON envelope.
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("etag")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      type: "json",
      data: { saved: true },
    });
  });

  it("honors q=0 and returns the ordinary representation with Vary: Accept", async () => {
    const app = createFormApp();
    const response = await formRequest(app, "/save", {
      ...urlencoded({ ok: "1" }),
      accept: `${FORM_MEDIA_TYPE}; q=0`,
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("etag")).toBe('"representation"');
    expect(response.headers.get("vary")).toBe("Origin, Accept");
    await expect(response.json()).resolves.toEqual({ saved: true });
  });

  it("does not negotiate direct document GET requests", async () => {
    const app = createFormApp();
    const response = await formRequest(app, "/save", { method: "GET" });

    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("vary")).toBeNull();
    await expect(response.json()).resolves.toEqual({ loaded: true });
  });

  it("emits an invalid envelope and preserves its status", async () => {
    const app = createFormApp();
    const response = await formRequest(app, "/feedback", {
      ...urlencoded({ message: "  " }),
      referer: "https://example.com/feedback",
    });

    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toBe(FORM_MEDIA_TYPE);
    await expect(response.json()).resolves.toEqual({
      type: "invalid",
      errors: { message: "Enter a message before sending." },
    });
  });

  it("emits a readable redirect directive without a wire Location", async () => {
    const app = createFormApp();
    const response = await formRequest(app, "/feedback", {
      ...urlencoded({ message: "hello", intent: "send" }),
      referer: "https://example.com/feedback",
    });

    // The envelope keeps the redirect's own status but strips the wire Location,
    // so fetch cannot follow it — the browser Form reads the directive instead.
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toContain("last_feedback=received");
    await expect(response.json()).resolves.toEqual({
      type: "redirect",
      to: "/feedback/thanks",
    });
  });

  it("renders in place only when the Referer path equals the action", async () => {
    const app = createFormApp({
      applicationConfig: defineConfig({
        name: "form-test",
        compatibilityDate: "2026-08-31",
        responseHeaders: () => ({ etag: '"global"', "x-global": "yes" }),
      }),
    });
    const response = await formRequest(app, "/feedback", {
      ...urlencoded({ message: "draft", intent: "preview" }),
      referer: "https://example.com/feedback?from=home",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(FORM_MEDIA_TYPE);
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("x-global")).toBe("yes");
    await expect(response.json()).resolves.toEqual({
      type: "render",
      route: FEEDBACK_ID,
      props: { message: "draft", preview: true },
      meta: {
        title: "Preview: draft",
        canonical: "https://example.com/feedback?from=home",
      },
    });
  });

  it("fails closed to the error boundary when a form render crosses pages", async () => {
    const app = createFormApp();
    const response = await formRequest(app, "/cross", {
      ...urlencoded({ any: "1" }),
      referer: "https://example.com/elsewhere",
    });

    // res.render() from an action that is not the displayed page throws; the
    // ordinary error boundary answers with HTML, so the browser Form reads a
    // non-form content type and falls back to a full document load.
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).not.toBe(FORM_MEDIA_TYPE);
    expect(response.headers.get("vary")).toBe("Accept");
  });

  it("keeps pre-hydration multipart POST results as ordinary representations", async () => {
    const app = createFormApp();

    // Native POST is an ordinary document request. res.render() is full HTML and
    // remains unrestricted by the enhanced same-page render guard.
    const rendered = await formRequest(app, "/feedback", {
      ...multipart({ message: "hi", intent: "preview" }),
      accept: "text/html",
      referer: "https://example.com/feedback",
    });
    expect(rendered.status).toBe(200);
    expect(rendered.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(rendered.headers.get("vary")).toBe("Accept");
    await expect(rendered.text()).resolves.toContain("preview:hi");

    // res.redirect() remains a wire redirect with a Location header.
    const redirected = await formRequest(app, "/feedback", {
      ...multipart({ message: "hi", intent: "send" }),
      accept: "text/html",
      referer: "https://example.com/feedback",
    });
    expect(redirected.status).toBe(303);
    expect(redirected.headers.get("location")).toBe("/feedback/thanks");
    expect(redirected.headers.get("content-type")).not.toBe(FORM_MEDIA_TYPE);
    expect(redirected.headers.get("vary")).toBe("Accept");

    // res.json() and res.invalid() remain JSON documents for the browser to load.
    const json = await formRequest(app, "/save", {
      ...multipart({ ok: "1" }),
      accept: "text/html",
    });
    expect(json.status).toBe(201);
    expect(json.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    await expect(json.json()).resolves.toEqual({ saved: true });

    const invalid = await formRequest(app, "/feedback", {
      ...multipart({ message: "" }),
      accept: "text/html",
    });
    expect(invalid.status).toBe(422);
    expect(invalid.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(invalid.headers.get("vary")).toBe("Accept");
    await expect(invalid.json()).resolves.toEqual({
      errors: { message: "Enter a message before sending." },
    });
  });

  it("marks fallback responses and preserves wildcard Vary on non-form results", async () => {
    const app = createFormApp();

    const fallback = await formRequest(app, "/missing", { accept: "text/html" });
    expect(fallback.status).toBe(404);
    expect(fallback.headers.get("vary")).toBe("Accept");

    const plain = await formRequest(app, "/plain");
    expect(plain.status).toBe(200);
    expect(plain.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(plain.headers.get("vary")).toBe("*");
    await expect(plain.text()).resolves.toBe("plain");
  });

  it("passes development mode to the handler response builder", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const app = createFormApp({ mode: "development" });
      const response = await formRequest(app, "/feedback", {
        ...urlencoded({ message: "hi", intent: "warn" }),
        referer: "https://example.com/feedback",
      });

      expect(response.status).toBe(422);
      expect(warning).toHaveBeenCalledWith(
        '[Goribu] res.invalid(errors, status) received non-string messages for "message". Form error values should be strings.',
      );
    } finally {
      warning.mockRestore();
    }
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
