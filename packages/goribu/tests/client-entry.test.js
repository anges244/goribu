import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClientEntry } from "goribu";
import {
  PROPS_SCRIPT_ID,
  ROUTE_SCRIPT_ID,
  RenderDataContext,
  serializePropsForScript,
  serializeRouteForScript,
} from "../src/rendering/render-context.js";

describe("ClientEntry", () => {
  it("requires the development client module URL", () => {
    expect(() => ClientEntry()).toThrow(
      /\[Goribu\].*<ClientEntry src> requires a non-empty client module URL/s,
    );
  });

  it("emits inert route data, inert props, then the browser module entry", () => {
    const routeId = "src/routes/index.jsx";
    const props = { title: "Hydrate me" };
    const html = renderToStaticMarkup(
      h(
        RenderDataContext.Provider,
        {
          value: Object.freeze({
            routeJson: serializeRouteForScript(routeId),
            propsJson: serializePropsForScript(props),
          }),
        },
        h(ClientEntry, { src: "/src/client-entry.js" }),
      ),
    );

    const routeIndex = html.indexOf(`id="${ROUTE_SCRIPT_ID}"`);
    const propsIndex = html.indexOf(`id="${PROPS_SCRIPT_ID}"`);
    const entryIndex = html.indexOf(
      '<script type="module" src="/src/client-entry.js"></script>',
    );

    expect(routeIndex).toBeGreaterThan(-1);
    expect(propsIndex).toBeGreaterThan(routeIndex);
    expect(entryIndex).toBeGreaterThan(propsIndex);
    expect(html).toContain(JSON.stringify(props));
  });
});
