import { describe, expect, it } from "vitest";
import { appendSetCookies } from "../src/runtime/cookies/append-set-cookies.js";
import { createCookieJar } from "../src/runtime/cookies/create-cookie-jar.js";
import { parseCookie } from "../src/runtime/cookies/parse-cookie.js";
import { serializeCookie } from "../src/runtime/cookies/serialize-cookie.js";

describe("parseCookie", () => {
  it("parses opaque values narrowly, ignores malformed entries, and keeps the first duplicate", () => {
    const cookies = parseCookie(
      " theme = dark ; token=a=b=c; encoded=a%20b; broken; =empty; " +
        "duplicate=first; duplicate=second; bad name=value ",
    );

    expect([...cookies]).toEqual([
      ["theme", "dark"],
      ["token", "a=b=c"],
      ["encoded", "a%20b"],
      ["duplicate", "first"],
    ]);
  });

  it("treats an absent header as empty and rejects invalid internal calls", () => {
    expect([...parseCookie(null)]).toEqual([]);
    expect([...parseCookie(undefined)]).toEqual([]);
    expect([...parseCookie("")]).toEqual([]);
    expect(() => parseCookie({})).toThrow(
      "[Goribu] parseCookie(header) requires a Cookie header string",
    );
  });
});

describe("serializeCookie", () => {
  it("adds only explicitly requested attributes", () => {
    expect(serializeCookie("theme", "dark")).toBe("theme=dark");
    expect(
      serializeCookie("session-id", "opaque%3Dvalue", {
        domain: ".example.com",
        path: "/account",
        maxAge: 3600,
        expires: new Date("2030-01-01T00:00:00.000Z"),
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      }),
    ).toBe(
      "session-id=opaque%3Dvalue; Domain=.example.com; Path=/account; " +
        "Max-Age=3600; Expires=Tue, 01 Jan 2030 00:00:00 GMT; " +
        "HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("rejects invalid outgoing data and unsupported options with teaching errors", () => {
    expect(() => serializeCookie("bad name", "value")).toThrow(
      "[Goribu] Invalid outgoing cookie name",
    );
    expect(() => serializeCookie("name", "needs encoding")).toThrow(
      "[Goribu] Invalid outgoing cookie value",
    );
    expect(() => serializeCookie("name", "value", { path: "relative" })).toThrow(
      "[Goribu] Invalid cookie path",
    );
    expect(() =>
      serializeCookie("name", "value", { domain: "https://example.com" }),
    ).toThrow("[Goribu] Invalid cookie domain");
    expect(() => serializeCookie("name", "value", { domain: 42 })).toThrow(
      "[Goribu] Invalid cookie domain 42",
    );
    expect(() =>
      serializeCookie("name", "value", { expires: new Date("invalid") }),
    ).toThrow("[Goribu] Invalid cookie expires value");
    expect(() =>
      serializeCookie("name", "value", {
        expires: new Date("1500-01-01T00:00:00.000Z"),
      }),
    ).toThrow("UTC year is from 1601 through 9999");
    const farFuture = new Date(0);
    farFuture.setUTCFullYear(10000);
    expect(() =>
      serializeCookie("name", "value", { expires: farFuture }),
    ).toThrow("UTC year is from 1601 through 9999");
    expect(() => serializeCookie("name", "value", { maxAge: 1.5 })).toThrow(
      "[Goribu] Invalid cookie maxAge value",
    );
    expect(() =>
      serializeCookie("name", "value", { sameSite: "sometimes" }),
    ).toThrow("[Goribu] Invalid cookie sameSite value");
    expect(() => serializeCookie("name", "value", { priority: "high" })).toThrow(
      "[Goribu] Unsupported cookie option",
    );

    Object.defineProperty(Object.prototype, "secure", {
      configurable: true,
      value: true,
    });
    try {
      expect(serializeCookie("name", "value", {})).toBe("name=value");
    } finally {
      delete Object.prototype.secure;
    }
  });
});

describe("createCookieJar", () => {
  it("reads incoming cookies and queues explicit set and delete operations", () => {
    const jar = createCookieJar(
      new Request("https://example.com/", {
        headers: { cookie: "theme=first; theme=second; encoded=a%20b" },
      }),
    );

    expect(jar.get("theme")).toBe("first");
    expect(jar.get("encoded")).toBe("a%20b");
    expect(jar.get("missing")).toBeNull();

    jar.set("preference", "compact", { sameSite: "Strict" });
    jar.delete("session", { path: "/account", domain: "example.com" });

    const snapshot = jar.pending;
    expect(snapshot).toEqual([
      "preference=compact; SameSite=Strict",
      "session=; Domain=example.com; Path=/account; Max-Age=0; " +
        "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);

    jar.set("later", "value");
    expect(snapshot).toHaveLength(2);
    expect(jar.pending).toHaveLength(3);
  });

  it("deletes without an implicit path and rejects non-matching deletion options", () => {
    const jar = createCookieJar(new Request("https://example.com/"));

    jar.delete("session");
    expect(jar.pending).toEqual([
      "session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ]);
    expect(() => jar.delete("session", { secure: true })).toThrow(
      "[Goribu] cookies.delete(name, options) does not support option",
    );
    expect(() => createCookieJar({})).toThrow(
      "[Goribu] createCookieJar(request) requires a Web Request",
    );
  });
});

describe("appendSetCookies", () => {
  it("preserves copied application cookies and appends framework cookies separately", () => {
    const headers = new Headers();
    headers.append("set-cookie", "application=one");
    headers.append("set-cookie", "application=two");
    const response = new Response("ok", { headers });

    const copiedHeaders = new Headers(response.headers);
    expect(copiedHeaders.getSetCookie()).toEqual([
      "application=one",
      "application=two",
    ]);

    const finalResponse = appendSetCookies(response, ["goribu-example=three"]);

    expect(finalResponse.headers.getSetCookie()).toEqual([
      "application=one",
      "application=two",
      "goribu-example=three",
    ]);
    expect(response.headers.getSetCookie()).toEqual([
      "application=one",
      "application=two",
    ]);
  });

  it("rebuilds a streaming response without consuming or buffering its body", async () => {
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
      headers: { "x-stream": "yes" },
    });

    const finalResponse = appendSetCookies(response, ["pending=yes"]);

    expect(finalResponse).not.toBe(response);
    expect(finalResponse.status).toBe(202);
    expect(finalResponse.statusText).toBe("Accepted");
    expect(finalResponse.headers.get("x-stream")).toBe("yes");
    expect(finalResponse.headers.getSetCookie()).toEqual(["pending=yes"]);
    expect(finalResponse.body).toBe(response.body);
    expect(finalResponse.bodyUsed).toBe(false);

    release();
    await expect(finalResponse.text()).resolves.toBe("streamed");
  });

  it("returns the original response when no cookies are pending", () => {
    const response = new Response("unchanged");
    expect(appendSetCookies(response, [])).toBe(response);
  });

  it("rebuilds responses with immutable headers", () => {
    const response = Response.redirect("https://example.com/next", 303);
    expect(() => response.headers.set("x-test", "no")).toThrow();

    const finalResponse = appendSetCookies(response, ["redirect=yes"]);

    expect(finalResponse.status).toBe(303);
    expect(finalResponse.headers.get("location")).toBe(
      "https://example.com/next",
    );
    expect(finalResponse.headers.getSetCookie()).toEqual(["redirect=yes"]);
  });

  it("rejects unsafe reconstruction and malformed internal inputs", async () => {
    const consumed = new Response("already read");
    await consumed.text();

    expect(() => appendSetCookies(consumed, ["pending=yes"])).toThrow(
      "[Goribu] Cannot append pending cookies because the final Web Response body was already consumed",
    );
    expect(() => appendSetCookies(new Response(), "pending=yes")).toThrow(
      "[Goribu] appendSetCookies(response, cookieStrings) requires an array",
    );
    expect(() => appendSetCookies(new Response(), ["bad\r\nvalue"])).toThrow(
      "[Goribu] Pending Set-Cookie value at index 0 is invalid",
    );
  });
});
