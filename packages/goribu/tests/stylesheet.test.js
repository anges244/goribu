import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Stylesheet } from "goribu";
import { RenderDataContext } from "../src/rendering/render-context.js";

describe("Stylesheet", () => {
  it("emits the deduplicated styles resolved from the production client graph", () => {
    const html = renderToStaticMarkup(
      h(
        RenderDataContext.Provider,
        {
          value: Object.freeze({
            clientAssets: Object.freeze({
              src: "/_goribu/assets/client.js",
              modulePreloads: Object.freeze([]),
              styles: Object.freeze([
                "/_goribu/assets/app.css",
                "/_goribu/assets/page.css",
              ]),
            }),
          }),
        },
        h(Stylesheet),
      ),
    );

    expect(html).toBe(
      '<link rel="stylesheet" href="/_goribu/assets/app.css"/><link rel="stylesheet" href="/_goribu/assets/page.css"/>',
    );
  });

  it("emits nothing when no production asset graph is present", () => {
    expect(renderToStaticMarkup(h(Stylesheet))).toBe("");
  });
});
