import { describe, expect, it } from "vitest";
import { readInitialRenderData } from "../src/browser/read-initial-render-data.js";
import {
  PROPS_SCRIPT_ID,
  ROUTE_SCRIPT_ID,
} from "../src/rendering/render-context.js";

describe("readInitialRenderData", () => {
  it("reads a matched route ID and object props from inert scripts", () => {
    const props = { title: "Hello", nested: { ready: true } };
    const result = readInitialRenderData(
      documentWith({
        [ROUTE_SCRIPT_ID]: jsonScript({ id: "src/routes/index.jsx" }),
        [PROPS_SCRIPT_ID]: jsonScript(props),
      }),
    );

    expect(result).toEqual({ routeId: "src/routes/index.jsx", props });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns null when the page intentionally has no hydration route", () => {
    expect(
      readInitialRenderData(
        documentWith({
          [PROPS_SCRIPT_ID]: jsonScript({ errorId: "error-1" }),
        }),
      ),
    ).toBeNull();
  });

  it("fails closed when present hydration data is malformed or incomplete", () => {
    expect(() => readInitialRenderData(undefined)).toThrow(
      "[Goribu] Cannot read initial render data because the browser document is unavailable",
    );
    expect(() =>
      readInitialRenderData(
        documentWith({
          [ROUTE_SCRIPT_ID]: jsonScript(
            { id: "src/routes/index.jsx" },
            "text/javascript",
          ),
        }),
      ),
    ).toThrow(
      `[Goribu] Cannot read initial route data because #${ROUTE_SCRIPT_ID} is not an inert <script type="application/json">`,
    );
    expect(() =>
      readInitialRenderData(
        documentWith({ [ROUTE_SCRIPT_ID]: jsonScriptText("not json") }),
      ),
    ).toThrow(`[Goribu] Cannot parse initial route data from #${ROUTE_SCRIPT_ID}`);
    expect(() =>
      readInitialRenderData(
        documentWith({ [ROUTE_SCRIPT_ID]: jsonScript({ id: "" }) }),
      ),
    ).toThrow(
      `[Goribu] Initial route data in #${ROUTE_SCRIPT_ID} must contain a non-empty string id`,
    );
    expect(() =>
      readInitialRenderData(
        documentWith({
          [ROUTE_SCRIPT_ID]: jsonScript({ id: "src/routes/index.jsx" }),
        }),
      ),
    ).toThrow(`#${PROPS_SCRIPT_ID} is missing`);
    expect(() =>
      readInitialRenderData(
        documentWith({
          [ROUTE_SCRIPT_ID]: jsonScript({ id: "src/routes/index.jsx" }),
          [PROPS_SCRIPT_ID]: jsonScript([]),
        }),
      ),
    ).toThrow(
      `[Goribu] Initial page props in #${PROPS_SCRIPT_ID} must be a JSON object`,
    );
  });
});

function documentWith(elements) {
  return {
    getElementById(id) {
      return elements[id] ?? null;
    },
  };
}

function jsonScript(value, type = "application/json") {
  return jsonScriptText(JSON.stringify(value), type);
}

function jsonScriptText(textContent, type = "application/json") {
  return {
    tagName: "SCRIPT",
    textContent,
    getAttribute(name) {
      return name === "type" ? type : null;
    },
  };
}
