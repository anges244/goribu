import { describe, expect, it } from "vitest";
import { readFormEnvelope } from "../src/browser/read-form-envelope.js";
import { FORM_MEDIA_TYPE } from "../src/forms/form-protocol.js";

describe("readFormEnvelope", () => {
  it.each([
    [{ type: "reload" }, { type: "reload" }],
    [
      { type: "json", data: { saved: true } },
      { type: "json", data: { saved: true } },
    ],
    [
      { type: "invalid", errors: { title: "Required" } },
      { type: "invalid", errors: { title: "Required" } },
    ],
    [
      { type: "redirect", to: "/done" },
      { type: "redirect", to: "/done" },
    ],
    [
      {
        type: "render",
        route: "src/routes/todos.jsx",
        props: { count: 2 },
        meta: { title: "Todos" },
      },
      {
        type: "render",
        routeId: "src/routes/todos.jsx",
        props: { count: 2 },
        meta: { title: "Todos" },
      },
    ],
  ])("accepts one valid negotiated variant", async (body, expected) => {
    await expect(readFormEnvelope(formResponse(body))).resolves.toEqual(expected);
  });

  it("matches the media type with parameters and leaves the original body readable", async () => {
    const response = formResponse(
      { type: "json", data: { saved: true } },
      `${FORM_MEDIA_TYPE}; charset=utf-8`,
    );

    await readFormEnvelope(response);

    await expect(response.json()).resolves.toEqual({
      type: "json",
      data: { saved: true },
    });
  });

  it("fails closed with repair instructions for unusable responses", async () => {
    await expect(readFormEnvelope({})).rejects.toThrow(
      "Pass the Response returned by fetch() directly",
    );

    await expect(
      readFormEnvelope(
        new Response("<html>error</html>", {
          status: 500,
          headers: { "content-type": "text/html" },
        }),
      ),
    ).rejects.toThrow(
      "Return res.json(), res.invalid(), res.redirect(), or res.render()",
    );

    await expect(
      readFormEnvelope(
        new Response("{", {
          headers: { "content-type": FORM_MEDIA_TYPE },
        }),
      ),
    ).rejects.toThrow(
      "instead of writing the form protocol body by hand",
    );
  });

  it.each([
    null,
    {},
    { type: "json" },
    { type: "invalid", errors: null },
    { type: "invalid", errors: { title: 1 } },
    { type: "redirect", to: "" },
    { type: "render", route: "src/routes/index.jsx", props: {} },
    { type: "render", route: "", props: {}, meta: {} },
    { type: "render", route: "src/routes/index.jsx", props: [], meta: {} },
    { type: "unknown" },
  ])("rejects malformed envelope %#", async (body) => {
    await expect(readFormEnvelope(formResponse(body))).rejects.toThrow(
      /^\[Goribu\] Form submission returned an invalid envelope.*Rebuild the Worker and client together/,
    );
  });
});

function formResponse(body, contentType = FORM_MEDIA_TYPE) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": contentType },
  });
}
