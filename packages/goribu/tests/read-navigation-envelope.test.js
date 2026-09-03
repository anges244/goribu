import { describe, expect, it } from "vitest";
import { readNavigationEnvelope } from "../src/browser/read-navigation-envelope.js";

describe("readNavigationEnvelope", () => {
  it.each([
    [
      {
        kind: "render",
        routeId: "src/routes/index.jsx",
        props: { ok: true },
        meta: { title: "Home" },
        status: 202,
      },
      {
        kind: "render",
        routeId: "src/routes/index.jsx",
        props: { ok: true },
        meta: { title: "Home" },
        status: 202,
      },
    ],
    [
      { kind: "redirect", location: "/login", status: 303 },
      { kind: "redirect", location: "/login", status: 303 },
    ],
    [{ kind: "reload" }, { kind: "reload" }],
  ])("accepts one valid kind-tagged variant", async (body, expected) => {
    await expect(readNavigationEnvelope(jsonResponse(body))).resolves.toEqual(expected);
  });

  it("fails closed on non-protocol content and malformed JSON", async () => {
    await expect(
      readNavigationEnvelope(
        new Response("<html>error</html>", {
          status: 500,
          headers: { "content-type": "text/html" },
        }),
      ),
    ).rejects.toThrow("instead of application/json");

    await expect(
      readNavigationEnvelope(
        new Response("{", {
          headers: { "content-type": "application/json" },
        }),
      ),
    ).rejects.toThrow("Navigation endpoint returned malformed JSON");
  });

  it("requires metadata in the render envelope shape", async () => {
    await expect(
      readNavigationEnvelope(
        jsonResponse({
          kind: "render",
          routeId: "src/routes/index.jsx",
          props: {},
        }),
      ),
    ).rejects.toThrow(
      'render data shaped as { kind: "render", routeId, props, meta, status }',
    );
  });

  it.each([
    null,
    {},
    { kind: "render", routeId: "", props: {}, status: 200 },
    { kind: "render", routeId: "src/routes/index.jsx", props: {}, status: 200 },
    { kind: "render", routeId: "src/routes/index.jsx", props: [], status: 200 },
    { kind: "render", routeId: "src/routes/index.jsx", props: {} },
    { kind: "render", routeId: "src/routes/index.jsx", props: {}, status: 199 },
    { kind: "redirect", location: "/", status: 200 },
    { kind: "redirect", location: "", status: 303 },
    { kind: "unknown" },
  ])("rejects malformed envelope %#", async (body) => {
    await expect(readNavigationEnvelope(jsonResponse(body))).rejects.toThrow(
      /^\[Goribu\] Navigation endpoint returned an invalid envelope/,
    );
  });
});

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
