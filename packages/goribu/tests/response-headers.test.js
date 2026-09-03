import { describe, expect, it, vi } from "vitest";
import {
  applyGlobalResponseHeaders,
  assertOptionalResponseHeaders,
  createResponseNonce,
  resolveGlobalResponseHeaders,
} from "../src/runtime/response-headers.js";

describe("global response headers", () => {
  it("calls the policy with the exact request context in a frozen wrapper", () => {
    const request = new Request("https://example.com/account");
    const env = { API: { name: "binding" } };
    const responseHeaders = vi.fn((context) => {
      expect(Object.isFrozen(context)).toBe(true);
      expect(context).toEqual({
        request,
        env,
        mode: "development",
        nonce: "request-nonce",
      });
      expect(context.request).toBe(request);
      expect(context.env).toBe(env);
      return {
        "X-Mode": context.mode,
        "content-security-policy": `script-src 'nonce-${context.nonce}'`,
        vary: ["Accept", "Origin"],
      };
    });

    expect(
      assertOptionalResponseHeaders(responseHeaders, "createApp responseHeaders"),
    ).toBe(responseHeaders);
    const headers = resolveGlobalResponseHeaders({
      responseHeaders,
      request,
      env,
      mode: "development",
      nonce: "request-nonce",
    });

    expect(responseHeaders).toHaveBeenCalledTimes(1);
    expect(headers).toBeInstanceOf(Headers);
    expect(headers.get("x-mode")).toBe("development");
    expect(headers.get("content-security-policy")).toBe(
      "script-src 'nonce-request-nonce'",
    );
    expect(headers.get("vary")).toBe("Accept, Origin");
  });

  it("treats an omitted callback as an empty policy and rejects static objects", () => {
    const headers = resolveGlobalResponseHeaders({
      request: new Request("https://example.com/"),
      env: {},
      mode: "production",
      nonce: "nonce",
    });
    const response = new Response("unchanged");

    expect([...headers]).toEqual([]);
    expect(applyGlobalResponseHeaders(response, headers)).toBe(response);
    expect(assertOptionalResponseHeaders(undefined, "createApp")).toBeUndefined();
    expect(() =>
      assertOptionalResponseHeaders({ "x-static": "no" }, "createApp"),
    ).toThrow(
      "[Goribu] createApp must be a responseHeaders callback when provided",
    );
  });

  it("rejects every unsafe blanket header case-insensitively", () => {
    const unsafeNames = [
      "Content-Length",
      "CONTENT-RANGE",
      "content-encoding",
      "Content-Type",
      "LOCATION",
      "Set-Cookie",
      "Trailer",
      "Transfer-Encoding",
    ];

    for (const name of unsafeNames) {
      expect(() =>
        resolveGlobalResponseHeaders({
          responseHeaders: () => ({ [name]: "unsafe" }),
          request: new Request("https://example.com/"),
          env: {},
          mode: "production",
          nonce: "nonce",
        }),
      ).toThrow(
        `[Goribu] responseHeaders cannot set unsafe blanket header "${name}"`,
      );
    }
  });

  it("rejects asynchronous, thenable, malformed, and invalid callback results", () => {
    const resolve = (responseHeaders) =>
      resolveGlobalResponseHeaders({
        responseHeaders,
        request: new Request("https://example.com/"),
        env: {},
        mode: "production",
        nonce: "nonce",
      });

    expect(() => resolve(async () => ({ "x-late": "no" }))).toThrow(
      /\[Goribu\].*synchronously.*Promises and thenables/,
    );
    expect(() =>
      resolve(() => ({ then() {}, "x-late": "no" })),
    ).toThrow(/\[Goribu\].*synchronously.*thenables/);
    expect(() => resolve(() => null)).toThrow(
      "[Goribu] responseHeaders must return a plain object",
    );
    expect(() => resolve(() => new Headers({ "x-value": "no" }))).toThrow(
      "[Goribu] responseHeaders must return a plain object",
    );
    expect(() => resolve(() => ({ "x-count": 2 }))).toThrow(
      '[Goribu] Global response header "x-count" must be a string or an array of strings',
    );
    expect(() => resolve(() => ({ "bad header": "value" }))).toThrow(
      '[Goribu] Invalid global response header "bad header"',
    );
    expect(() => resolve(() => ({ "x-value": "line\nbreak" }))).toThrow(
      '[Goribu] Invalid global response header "x-value"',
    );
  });

  it("applies global headers as defaults while existing response headers win", () => {
    const response = new Response("body", {
      headers: {
        "cache-control": "private",
        "x-response": "route",
      },
    });
    const applied = applyGlobalResponseHeaders(
      response,
      Object.freeze({
        "Cache-Control": "public, max-age=60",
        "x-response": "global",
        "x-global": "yes",
      }),
    );

    expect(applied).not.toBe(response);
    expect(applied.headers.get("cache-control")).toBe("private");
    expect(applied.headers.get("x-response")).toBe("route");
    expect(applied.headers.get("x-global")).toBe("yes");

    const noChanges = applyGlobalResponseHeaders(
      response,
      new Headers({ "cache-control": "public", "x-response": "global" }),
    );
    expect(noChanges).toBe(response);
  });

  it("token-merges Vary case-insensitively and lets a wildcard win", () => {
    const response = new Response(null, {
      headers: { vary: "Accept-Encoding, Origin" },
    });
    const merged = applyGlobalResponseHeaders(
      response,
      new Headers({ vary: "origin, Accept, ACCEPT" }),
    );

    expect(merged.headers.get("vary")).toBe(
      "Accept-Encoding, Origin, Accept",
    );
    expect(
      applyGlobalResponseHeaders(
        response,
        new Headers({ vary: "ORIGIN" }),
      ),
    ).toBe(response);

    const globalWildcard = applyGlobalResponseHeaders(
      response,
      new Headers({ vary: "Accept, *" }),
    );
    expect(globalWildcard.headers.get("vary")).toBe("*");

    const responseWildcard = new Response(null, {
      headers: { vary: "*, Accept" },
    });
    const normalizedWildcard = applyGlobalResponseHeaders(
      responseWildcard,
      new Headers({ vary: "Origin" }),
    );
    expect(normalizedWildcard.headers.get("vary")).toBe("*");
  });

  it("preserves status, status text, and the unread body stream identity", async () => {
    let release;
    const stream = new ReadableStream({
      start(controller) {
        release = () => {
          controller.enqueue(new TextEncoder().encode("streamed"));
          controller.close();
        };
      },
    });
    const response = new Response(stream, {
      status: 202,
      statusText: "Accepted",
      headers: { "x-route": "yes" },
    });

    const applied = applyGlobalResponseHeaders(
      response,
      new Headers({ "x-global": "yes" }),
    );

    expect(applied).not.toBe(response);
    expect(applied.status).toBe(202);
    expect(applied.statusText).toBe("Accepted");
    expect(applied.body).toBe(response.body);
    expect(applied.bodyUsed).toBe(false);
    expect(response.bodyUsed).toBe(false);

    release();
    await expect(applied.text()).resolves.toBe("streamed");
  });

  it("creates a secure URL/header-safe nonce and teaches when Web Crypto is unavailable", () => {
    const getRandomValues = vi.fn((bytes) => {
      bytes.fill(0xab);
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    try {
      const nonce = createResponseNonce();
      expect(getRandomValues).toHaveBeenCalledTimes(1);
      expect(nonce).toBe("ab".repeat(16));
      expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);

      vi.stubGlobal("crypto", undefined);
      expect(() => createResponseNonce()).toThrow(
        "[Goribu] createResponseNonce() requires crypto.getRandomValues()",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
