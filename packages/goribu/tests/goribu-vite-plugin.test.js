import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { goribu } from "goribu/vite";

const created = [];

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "goribu-plugin-"));
  created.push(root);
  return root;
}

function goribuPlugin() {
  return goribu().find((candidate) => candidate?.name === "goribu");
}

afterEach(() => {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("goribu()", () => {
  it("rejects options with a teaching error", () => {
    expect(() => goribu({})).toThrow(/does not accept options/);
  });

  it("returns a plugin array that includes the goribu plugin", () => {
    const plugins = goribu();
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins.some((plugin) => plugin?.name === "goribu")).toBe(true);
  });

  const emitHeadersFor = (environmentName) => {
    const emitted = [];
    goribuPlugin().generateBundle.call({
      environment: { name: environmentName },
      emitFile: (file) => emitted.push(file),
    });
    return emitted;
  };

  const auditBundle = (bundle) => {
    goribuPlugin().writeBundle.call(
      {
        error: (message) => {
          throw new Error(typeof message === "string" ? message : message.message);
        },
      },
      {},
      bundle,
    );
  };

  it("emits a _headers asset that caches only the reserved fingerprinted namespace", () => {
    const client = emitHeadersFor("client");
    expect(client).toHaveLength(1);
    expect(client[0]).toMatchObject({ type: "asset", fileName: "_headers" });
    expect(client[0].source).toContain("/_goribu/assets/*");
    expect(client[0].source).toContain("Cache-Control: public, max-age=31536000, immutable");

    // The Worker build shares the plugin and must not receive the file.
    expect(emitHeadersFor("goribu_basic_app")).toHaveLength(0);
  });

  it("passes fingerprinted files and ignores files outside the reserved namespace", () => {
    expect(() =>
      auditBundle({
        "_goribu/assets/client-entry-BvRk9kiK.js": { type: "chunk" },
        "_goribu/assets/logo-A1b2C3d4.svg": { type: "asset" },
        "robots.txt": { type: "asset" },
        "assets/vendor.js": { type: "chunk" },
      }),
    ).not.toThrow();
  });

  it("fails closed on a non-fingerprinted file under the reserved namespace", () => {
    // An app that overrode the client output filenames to drop the hash.
    expect(() =>
      auditBundle({ "_goribu/assets/client-entry.js": { type: "chunk" } }),
    ).toThrow(/carries no content hash/);

    // A dictionary-word segment has no entropy, so it is not mistaken for a hash.
    expect(() =>
      auditBundle({ "_goribu/assets/navigation.js": { type: "chunk" } }),
    ).toThrow(/carries no content hash/);

    // A fixed-name asset emitted straight into the namespace by another plugin.
    expect(() =>
      auditBundle({ "_goribu/assets/logo.svg": { type: "asset" } }),
    ).toThrow(/carries no content hash/);
  });

  it("fails closed when the app ships its own public/_headers", async () => {
    const root = makeProject();
    mkdirSync(join(root, "public"), { recursive: true });
    writeFileSync(join(root, "public", "_headers"), "/*\n  X-Test: 1\n");

    await expect(goribuPlugin().config({ root })).rejects.toThrow(
      /Goribu generates the static-asset "_headers" file/,
    );
  });

  it("fails closed when the app publishes into the reserved /_goribu/ namespace", async () => {
    const root = makeProject();
    mkdirSync(join(root, "public", "_goribu"), { recursive: true });

    await expect(goribuPlugin().config({ root })).rejects.toThrow(
      /\/_goribu\/ URL namespace is reserved/,
    );
  });
});
