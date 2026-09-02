import { describe, expect, it } from "vitest";
import { composeMiddleware } from "../src/runtime/compose-middleware.js";
import { createResponse } from "../src/runtime/create-response.js";

describe("composeMiddleware", () => {
  it("runs synchronous and asynchronous middleware sequentially with shared objects", async () => {
    const trace = [];
    const request = {};
    const response = createResponse({ canRender: false });
    const run = composeMiddleware([
      (req) => {
        trace.push("outer");
        req.user = { name: "Ada" };
      },
      async (req) => {
        await Promise.resolve();
        trace.push(`inner:${req.user.name}`);
        req.ready = true;
      },
    ]);

    await expect(run(request, response)).resolves.toBeUndefined();
    expect(trace).toEqual(["outer", "inner:Ada"]);
    expect(request).toEqual({ user: { name: "Ada" }, ready: true });
  });

  it("returns the first terminal result without running later middleware", async () => {
    const trace = [];
    const response = createResponse({ canRender: false });
    const run = composeMiddleware([
      (request, res) => {
        trace.push("first");
        res.headers({ "x-outer": "yes" });
      },
      (request, res) => {
        trace.push("gate");
        return res.redirect("/login");
      },
      () => {
        trace.push("never");
      },
    ]);

    const result = await run({}, response);

    expect(result).toMatchObject({
      kind: "redirect",
      status: 303,
      location: "/login",
      headers: {
        location: "/login",
        "x-outer": "yes",
      },
    });
    expect(trace).toEqual(["first", "gate"]);
  });

  it("rejects accidental non-response returns instead of silently continuing", async () => {
    const response = createResponse({ canRender: false });
    const invalidResults = ["oops", false, null];

    for (const invalidResult of invalidResults) {
      function invalidMiddleware() {
        return invalidResult;
      }
      const run = composeMiddleware([invalidMiddleware]);

      await expect(run({}, response)).rejects.toThrow(
        '[Goribu] Middleware "invalidMiddleware" at index 0 returned a non-response value. Return nothing to continue, or return a res.* result',
      );
    }

    function rawResponse() {
      return new Response("raw");
    }
    const runRawResponse = composeMiddleware([rawResponse]);
    await expect(runRawResponse({}, response)).rejects.toThrow(
      '[Goribu] Middleware "rawResponse" at index 0 returned a Web Response. Return a res.* result instead so Goribu can apply cookies and other framework behavior',
    );
  });

  it("validates and snapshots the prepared chain", async () => {
    expect(() => composeMiddleware(null)).toThrow(
      "[Goribu] composeMiddleware(middleware) requires an ordered array of middleware functions",
    );
    expect(() => composeMiddleware([() => {}, "not middleware"])).toThrow(
      "[Goribu] Middleware at index 1 is not a function",
    );

    const trace = [];
    const source = [() => {
      trace.push("original");
    }];
    const run = composeMiddleware(source);
    source[0] = () => {
      trace.push("replacement");
    };
    source.push(() => {
      trace.push("late");
    });

    await run({}, createResponse({ canRender: false }));
    expect(trace).toEqual(["original"]);
  });

  it("propagates middleware errors unchanged for the app error boundary", async () => {
    const failure = new Error("database unavailable");
    const run = composeMiddleware([
      async function loadUser() {
        throw failure;
      },
    ]);

    await expect(
      run({}, createResponse({ canRender: false })),
    ).rejects.toBe(failure);
  });

  it("uses an empty chain as a no-op", async () => {
    const run = composeMiddleware([]);
    await expect(
      run({}, createResponse({ canRender: false })),
    ).resolves.toBeUndefined();
  });
});
