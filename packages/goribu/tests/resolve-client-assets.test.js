import { describe, expect, it } from "vitest";
import { resolveClientAssets } from "../src/rendering/resolve-client-assets.js";

const manifest = {
  entry: {
    file: "entry.js",
    imports: ["chunks/react.js"],
    css: ["assets/app.css"],
  },
  pages: {
    "src/routes/index.jsx": {
      file: "chunks/index-abc.js",
      imports: ["chunks/react.js", "chunks/shared-xyz.js"],
      css: ["assets/index.css"],
    },
  },
};

describe("resolveClientAssets", () => {
  it("resolves the entry, matched page chunk, shared preloads, and styles", () => {
    const resolved = resolveClientAssets({
      manifest,
      routeId: "src/routes/index.jsx",
    });

    expect(resolved.src).toBe("/entry.js");
    // Shared react chunk appears once even though entry and page both import it,
    // and the entry itself is never preloaded.
    expect(resolved.modulePreloads).toEqual([
      "/chunks/react.js",
      "/chunks/index-abc.js",
      "/chunks/shared-xyz.js",
    ]);
    expect(resolved.styles).toEqual(["/assets/app.css", "/assets/index.css"]);
    expect(resolved.modulePreloads).not.toContain("/entry.js");
  });

  it("returns entry-only assets when the route has no page chunk", () => {
    const resolved = resolveClientAssets({
      manifest,
      routeId: "src/routes/api-only.js",
    });

    expect(resolved.src).toBe("/entry.js");
    expect(resolved.modulePreloads).toEqual(["/chunks/react.js"]);
    expect(resolved.styles).toEqual(["/assets/app.css"]);
  });

  it("returns entry-only assets for error renders without a route ID", () => {
    const resolved = resolveClientAssets({ manifest });
    expect(resolved.src).toBe("/entry.js");
    expect(resolved.modulePreloads).toEqual(["/chunks/react.js"]);
  });

  it("applies a production client base to every URL", () => {
    const resolved = resolveClientAssets({
      manifest,
      routeId: "src/routes/index.jsx",
      base: "/_goribu/client",
    });

    expect(resolved.src).toBe("/_goribu/client/entry.js");
    expect(resolved.modulePreloads).toContain("/_goribu/client/chunks/index-abc.js");
    expect(resolved.styles).toContain("/_goribu/client/assets/index.css");
  });

  it("freezes the result so a render cannot mutate shared build data", () => {
    const resolved = resolveClientAssets({ manifest, routeId: "src/routes/index.jsx" });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.modulePreloads)).toBe(true);
  });

  it("rejects a manifest without a browser entry chunk", () => {
    expect(() => resolveClientAssets({ manifest: { pages: {} } })).toThrow(
      /entry\.file/,
    );
    expect(() => resolveClientAssets({ manifest: null })).toThrow(/\[Goribu\]/);
  });
});
