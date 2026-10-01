import { describe, expect, it, vi } from "vitest";
import { createRequest } from "../src/runtime/create-request.js";
import { createCookieJar } from "../src/runtime/cookies/create-cookie-jar.js";
import { isHttpError } from "../src/runtime/http-error.js";

const decoder = new TextDecoder();

describe("createRequest", () => {
  it("exposes the minimal Request surface and preserves special parameter names", () => {
    const request = new Request(
      "https://example.com/teams/member?tag=one&tag=two",
      { headers: { "x-request-id": "abc" } },
    );
    const params = { team: "Goribu" };
    const env = { DB: { binding: "primary" } };
    const d1 = () => {};
    const cache = { get: async () => null, set: async () => {}, delete: async () => {} };
    const waitUntil = vi.fn();
    const backgroundTask = Promise.resolve();
    Object.defineProperty(params, "__proto__", {
      enumerable: true,
      value: "member/admin",
    });

    const wrapped = createRequest(request, params, { env, waitUntil, d1, cache });

    expect(wrapped.method).toBe("GET");
    expect(wrapped.path).toBe("/teams/member");
    expect(wrapped.query).toBeInstanceOf(URLSearchParams);
    expect(wrapped.query.getAll("tag")).toEqual(["one", "two"]);
    expect(wrapped.headers).toBe(request.headers);
    expect(wrapped.headers.get("x-request-id")).toBe("abc");
    expect(wrapped.env).toBe(env);
    expect(wrapped.d1).toBe(d1);
    expect(wrapped.cache).toBe(cache);
    expect(wrapped).not.toHaveProperty("ctx");
    expect(wrapped.waitUntil(backgroundTask)).toBeUndefined();
    expect(waitUntil).toHaveBeenCalledWith(backgroundTask);
    expect(wrapped.params.team).toBe("Goribu");
    expect(Object.hasOwn(wrapped.params, "__proto__")).toBe(true);
    expect(wrapped.params.__proto__).toBe("member/admin");
    expect(Object.getPrototypeOf(wrapped.params)).toBe(Object.prototype);
    expect(Object.keys(wrapped).sort()).toEqual([
      "body",
      "cache",
      "cookies",
      "d1",
      "env",
      "headers",
      "kv",
      "method",
      "params",
      "path",
      "query",
      "r2",
      "rawBody",
      "waitUntil",
    ]);
  });

  it("reads incoming cookies and queues outgoing cookies through req.cookies", () => {
    const request = new Request("https://example.com/account", {
      headers: { cookie: "theme=dark" },
    });
    const cookies = createCookieJar(request);
    const wrapped = createRequest(request, {}, { cookies });

    expect(wrapped.cookies).toBe(cookies);
    expect(wrapped.cookies.get("theme")).toBe("dark");

    wrapped.cookies.set("theme", "light", { sameSite: "Lax" });
    expect(cookies.pending).toEqual(["theme=light; SameSite=Lax"]);
  });

  it("parses JSON objects and text using Content-Type parameters", async () => {
    const json = createRequest(
      new Request("https://example.com/items", {
        method: "POST",
        headers: { "content-type": "application/problem+json; charset=utf-8" },
        body: JSON.stringify({ title: "Not found", status: 404 }),
      }),
      {},
    );
    const text = createRequest(
      new Request("https://example.com/messages", {
        method: "POST",
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: "héllo Goribu",
      }),
      {},
    );

    await expect(json.body()).resolves.toEqual({
      title: "Not found",
      status: 404,
    });
    await expect(text.body()).resolves.toBe("héllo Goribu");
  });

  it.each(["urlencoded", "multipart"])("normalizes %s fields without coercion or prototype changes", async (encoding) => {
    const fields = new URLSearchParams("option=a&option=b&title=best+pizza&__proto__=safe&__proto__=again&constructor=own&empty=&count=42&enabled=false&user[name]=Ada");
    const submitted = encoding === "multipart" ? new FormData() : fields;
    if (encoding === "multipart") {
      for (const [name, value] of fields) submitted.append(name, value);
    }
    const wrapped = createRequest(
      new Request("https://example.com/forms", {
        method: "POST",
        body: submitted,
      }),
      {},
    );

    const body = await wrapped.body();

    expect(body.option).toEqual(["a", "b"]);
    expect(body.title).toBe("best pizza");
    expect(Object.hasOwn(body, "__proto__")).toBe(true);
    expect(body.__proto__).toEqual(["safe", "again"]);
    expect(body.constructor).toBe("own");
    expect(body.empty).toBe("");
    expect(body.count).toBe("42");
    expect(body.enabled).toBe("false");
    expect(body["user[name]"]).toBe("Ada");
    expect(Object.hasOwn(body, "missing")).toBe(false);
    expect(Object.getPrototypeOf(body)).toBe(Object.prototype);
  });

  it("normalizes multipart files and mixed repeated fields without losing bytes", async () => {
    const submitted = new FormData();
    submitted.append("tag", "one");
    submitted.append("tag", "two");
    submitted.append(
      "attachment",
      new Blob([new Uint8Array([0, 1, 2, 255])], {
        type: "application/octet-stream",
      }),
      "payload.bin",
    );
    submitted.append("mixed", "text first");
    submitted.append("mixed", submitted.get("attachment"));
    submitted.append("mixed", new File(["second"], "second.txt", { type: "text/plain" }));
    const wrapped = createRequest(
      new Request("https://example.com/upload", {
        method: "POST",
        body: submitted,
      }),
      {},
    );

    const body = await wrapped.body();
    const attachment = body.attachment;

    expect(Object.getPrototypeOf(body)).toBe(Object.prototype);
    expect(body.tag).toEqual(["one", "two"]);
    expect(attachment).toBeInstanceOf(File);
    expect(attachment.type).toBe("application/octet-stream");
    expect(body.mixed[0]).toBe("text first");
    expect(body.mixed.slice(1).map(file => file.name)).toEqual(["payload.bin", "second.txt"]);
    expect(await body.mixed[2].text()).toBe("second");
    expect(new Uint8Array(await body.mixed[1].arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(await wrapped.body()).toBe(body);
    expect((await wrapped.rawBody()).byteLength).toBeGreaterThan(0);
    expect(attachment.name).toBe("payload.bin");
    expect(new Uint8Array(await attachment.arrayBuffer())).toEqual(
      new Uint8Array([0, 1, 2, 255]),
    );
  });

  it("returns exact raw bytes and uses the documented friendly fallback", async () => {
    const bytes = new Uint8Array([0, 127, 128, 255]);
    const wrapped = createRequest(
      new Request("https://example.com/binary", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: bytes,
      }),
      {},
    );

    await expect(wrapped.rawBody()).resolves.toEqual(bytes);
    await expect(wrapped.body()).resolves.toEqual({});

    const withoutContentType = createRequest(
      new Request("https://example.com/unknown", {
        method: "POST",
        body: new TextEncoder().encode("untyped"),
      }),
      {},
    );
    await expect(withoutContentType.body()).resolves.toEqual({});
  });

  it.each([
    "application/json",
    "text/plain; charset=utf-8",
    "multipart/form-data; boundary=empty",
  ])("uses the friendly object fallback for an empty %s body", async (contentType) => {
    const wrapped = createRequest(
      new Request("https://example.com/empty", {
        method: "POST",
        headers: { "content-type": contentType },
      }),
      {},
    );

    await expect(wrapped.body()).resolves.toEqual({});
  });

  it.each(["rawBody first", "body first"])(
    "reads the Web Request body once when called repeatedly and mixed: %s",
    async (order) => {
      const source = JSON.stringify({ safe: true });
      const request = new Request("https://example.com/cache", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: source,
      });
      const arrayBuffer = vi.spyOn(request, "arrayBuffer");
      const wrapped = createRequest(request, {});

      if (order === "rawBody first") {
        expect(decoder.decode(await wrapped.rawBody())).toBe(source);
        await expect(wrapped.body()).resolves.toEqual({ safe: true });
      } else {
        await expect(wrapped.body()).resolves.toEqual({ safe: true });
        expect(decoder.decode(await wrapped.rawBody())).toBe(source);
      }

      await wrapped.rawBody();
      await wrapped.body();
      expect(arrayBuffer).toHaveBeenCalledTimes(1);
    },
  );

  it("turns malformed supported bodies into branded 400 teaching errors", async () => {
    const invalidJson = createRequest(
      new Request("https://example.com/json", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ broken",
      }),
      {},
    );
    const nonObjectJson = createRequest(
      new Request("https://example.com/json", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[1, 2]",
      }),
      {},
    );
    const missingMultipartBoundary = createRequest(
      new Request("https://example.com/form", {
        method: "POST",
        headers: { "content-type": "multipart/form-data" },
        body: "not multipart",
      }),
      {},
    );
    const malformedMultipart = createRequest(
      new Request("https://example.com/form", {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=goribu-test",
        },
        body: "not multipart",
      }),
      {},
    );

    const errors = await Promise.all([
      invalidJson.body().catch((error) => error),
      nonObjectJson.body().catch((error) => error),
      missingMultipartBoundary.body().catch((error) => error),
      malformedMultipart.body().catch((error) => error),
    ]);

    for (const error of errors) {
      expect(isHttpError(error)).toBe(true);
      expect(error.status).toBe(400);
    }
    expect(errors[0].message).toContain(
      "[Goribu] Could not parse the application/json request body. Send valid JSON",
    );
    expect(errors[0].cause).toBeInstanceOf(SyntaxError);
    expect(errors[1].message).toContain(
      "[Goribu] The application/json request body must contain a JSON object",
    );
    expect(errors[2].message).toContain(
      "[Goribu] Could not parse the multipart/form-data request body because its Content-Type is missing a boundary",
    );
    expect(errors[3].message).toContain(
      "[Goribu] Could not parse the multipart/form-data request body. Check that its boundary and multipart encoding are valid",
    );
    expect(errors[3].cause).toBeInstanceOf(TypeError);
  });

  it("rejects incorrect internal usage and an already-consumed Request", async () => {
    expect(() => createRequest({}, {})).toThrow(
      "[Goribu] createRequest(request, params) requires a Web Request",
    );
    expect(() =>
      createRequest(new Request("https://example.com"), { id: 42 }),
    ).toThrow('[Goribu] Route parameter "id" must be a string');
    const withoutRuntime = createRequest(
      new Request("https://example.com"),
      {},
    );
    expect(() => withoutRuntime.waitUntil(Promise.resolve())).toThrow(
      "[Goribu] req.waitUntil(promise) is unavailable because no Worker execution context was provided",
    );
    expect(() => withoutRuntime.waitUntil("not a promise")).toThrow(
      "[Goribu] req.waitUntil(promise) requires a Promise",
    );
    expect(() =>
      createRequest(new Request("https://example.com"), {}, { cookies: {} }),
    ).toThrow(
      "[Goribu] createRequest(request, params, runtime) requires runtime.cookies to be the request cookie jar",
    );

    const request = new Request("https://example.com", {
      method: "POST",
      body: "already read",
    });
    await request.text();
    const wrapped = createRequest(request, {});

    await expect(wrapped.rawBody()).rejects.toThrow(
      "[Goribu] Cannot read the request body because the Web Request body was already consumed",
    );
  });
});
