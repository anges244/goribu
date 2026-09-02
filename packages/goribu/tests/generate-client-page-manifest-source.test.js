import { parse } from "@babel/parser";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateClientPageManifestSource } from "../src/build/generate-client-page-manifest-source.js";

describe("generateClientPageManifestSource", () => {
  it("generates lazy virtual loaders only for routes with pages", () => {
    const page = {
      id: 'src/routes/safe-"page.js',
      filePath: resolve("/app/src/routes/safe-page.js"),
      hasDefaultExport: true,
    };
    const apiOnly = {
      id: "src/routes/api-only.js",
      filePath: resolve("/app/src/routes/api-only.js"),
      hasDefaultExport: false,
    };
    const source = generateClientPageManifestSource([page, apiOnly]);

    expect(() => parse(source, { sourceType: "module" })).not.toThrow();
    expect(source).toContain(JSON.stringify(page.id));
    expect(source).toContain("virtual:goribu/client-route:");
    expect(source).toContain(encodeURIComponent(page.filePath));
    expect(source).not.toContain(apiOnly.id);
    expect(source).not.toContain(apiOnly.filePath);
  });

  it("fails closed on malformed or duplicate manifest identities", () => {
    const page = {
      id: "src/routes/index.js",
      filePath: resolve("/app/src/routes/index.js"),
      hasDefaultExport: true,
    };

    expect(() => generateClientPageManifestSource({})).toThrow(
      /\[Goribu\].*requires the route array returned by generateManifest/s,
    );
    expect(() =>
      generateClientPageManifestSource([{ ...page, hasDefaultExport: "yes" }]),
    ).toThrow(/\[Goribu\].*manifest index 0.*id, filePath, and hasDefaultExport/s);
    expect(() => generateClientPageManifestSource([page, { ...page }])).toThrow(
      /\[Goribu\].*route ID.*appears more than once/s,
    );
    expect(() =>
      generateClientPageManifestSource([
        page,
        { ...page, id: "src/routes/other.js" },
      ]),
    ).toThrow(/\[Goribu\].*route source.*appears more than once/s);
  });
});
