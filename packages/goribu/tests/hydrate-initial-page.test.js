import { describe, expect, it, vi } from "vitest";
import { hydrateInitialPage } from "../src/browser/hydrate-initial-page.js";
import {
  PROPS_SCRIPT_ID,
  ROUTE_SCRIPT_ID,
} from "../src/rendering/render-context.js";

describe("hydrateInitialPage", () => {
  it("hydrates the matched generated page into #root with server props", async () => {
    function Page() {}
    const props = { title: "Hydrated", count: 2 };
    const rootElement = { nodeType: 1 };
    const root = { render() {} };
    const loader = vi.fn(async () => ({ default: Page }));
    const hydrate = vi.fn(() => root);

    await expect(
      hydrateInitialPage({
        browserDocument: documentWith({
          root: rootElement,
          [ROUTE_SCRIPT_ID]: jsonScript({ id: "src/routes/index.jsx" }),
          [PROPS_SCRIPT_ID]: jsonScript(props),
        }),
        pageLoaders: { "src/routes/index.jsx": loader },
        hydrate,
        location: "https://example.com/docs?view=full#intro",
      }),
    ).resolves.toBe(root);

    expect(loader).toHaveBeenCalledOnce();
    expect(hydrate).toHaveBeenCalledOnce();
    const [receivedRoot, page] = hydrate.mock.calls[0];
    expect(receivedRoot).toBe(rootElement);
    expect(page.props.children.props.location).toBe(
      "https://example.com/docs?view=full#intro",
    );
    expect(page.props.children.props.Page).toBe(Page);
    expect(page.props.children.props.pageProps).toEqual(props);
  });

  it("does nothing when the server render intentionally has no hydration route", async () => {
    const loader = vi.fn();
    const hydrate = vi.fn();

    await expect(
      hydrateInitialPage({
        browserDocument: documentWith({
          root: { nodeType: 1 },
          [PROPS_SCRIPT_ID]: jsonScript({ errorId: "error-1" }),
        }),
        pageLoaders: { "src/routes/index.jsx": loader },
        hydrate,
      }),
    ).resolves.toBeNull();
    expect(loader).not.toHaveBeenCalled();
    expect(hydrate).not.toHaveBeenCalled();
  });

  it("fails before loading without a root and preserves hydration failures", async () => {
    function Page() {}
    const loader = vi.fn(async () => ({ default: Page }));
    const routeData = {
      [ROUTE_SCRIPT_ID]: jsonScript({ id: "src/routes/index.jsx" }),
      [PROPS_SCRIPT_ID]: jsonScript({}),
    };

    await expect(
      hydrateInitialPage({
        browserDocument: documentWith(routeData),
        pageLoaders: { "src/routes/index.jsx": loader },
        hydrate: vi.fn(),
      }),
    ).rejects.toThrow(
      '[Goribu] Cannot hydrate route "src/routes/index.jsx" because the Document has no valid #root element',
    );
    expect(loader).not.toHaveBeenCalled();

    const hydrationFailure = new Error("markup mismatch");
    let thrown;
    try {
      await hydrateInitialPage({
        browserDocument: documentWith({
          ...routeData,
          root: { nodeType: 1 },
        }),
        pageLoaders: { "src/routes/index.jsx": loader },
        hydrate() {
          throw hydrationFailure;
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toContain(
      '[Goribu] Could not hydrate the initial page for route "src/routes/index.jsx"',
    );
    expect(thrown.cause).toBe(hydrationFailure);
  });
});

function documentWith(elements) {
  return {
    getElementById(id) {
      return elements[id] ?? null;
    },
  };
}

function jsonScript(value) {
  return {
    tagName: "SCRIPT",
    textContent: JSON.stringify(value),
    getAttribute(name) {
      return name === "type" ? "application/json" : null;
    },
  };
}
