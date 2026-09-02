import { describe, expect, it, vi } from "vitest";
import { loadClientPage } from "../src/browser/load-client-page.js";

describe("loadClientPage", () => {
  it("loads only the page keyed by the canonical route ID", async () => {
    function Page() {}
    const selected = vi.fn(async () => ({ default: Page }));
    const other = vi.fn(async () => ({ default: function OtherPage() {} }));

    await expect(
      loadClientPage({
        routeId: "src/routes/index.jsx",
        pageLoaders: {
          "src/routes/index.jsx": selected,
          "src/routes/other.jsx": other,
        },
      }),
    ).resolves.toBe(Page);
    expect(selected).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
  });

  it("rejects stale or malformed generated loader maps before loading", async () => {
    await expect(loadClientPage()).rejects.toThrow(
      "[Goribu] loadClientPage({ routeId, pageLoaders }) requires a non-empty canonical route ID",
    );
    await expect(
      loadClientPage({ routeId: "src/routes/index.jsx", pageLoaders: null }),
    ).rejects.toThrow(
      "[Goribu] loadClientPage({ routeId, pageLoaders }) requires the pageLoaders object generated from the current route manifest",
    );
    await expect(
      loadClientPage({ routeId: "toString", pageLoaders: {} }),
    ).rejects.toThrow(
      '[Goribu] Cannot load client page for route "toString" because the generated page manifest has no matching loader',
    );
    await expect(
      loadClientPage({
        routeId: "src/routes/index.jsx",
        pageLoaders: { "src/routes/index.jsx": {} },
      }),
    ).rejects.toThrow(
      '[Goribu] Client page loader for route "src/routes/index.jsx" is not a function',
    );
  });

  it("preserves load failures and rejects modules without a default page", async () => {
    const importFailure = new Error("chunk unavailable");
    let thrown;
    try {
      await loadClientPage({
        routeId: "src/routes/index.jsx",
        pageLoaders: {
          "src/routes/index.jsx": async () => {
            throw importFailure;
          },
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toContain(
      '[Goribu] Could not load the client page module for route "src/routes/index.jsx"',
    );
    expect(thrown.cause).toBe(importFailure);

    for (const pageModule of [null, {}, { default: "not a component" }]) {
      await expect(
        loadClientPage({
          routeId: "src/routes/index.jsx",
          pageLoaders: {
            "src/routes/index.jsx": async () => pageModule,
          },
        }),
      ).rejects.toThrow(
        '[Goribu] Loaded client page for route "src/routes/index.jsx" has no valid default React component',
      );
    }
  });
});
