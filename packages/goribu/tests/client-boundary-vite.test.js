import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { createClientBoundaryPlugin } from "../src/build/create-client-boundary-plugin.js";

const created = [];

function makeProject(files, { symlinked = false } = {}) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "goribu-client-boundary-"));
  created.push(temporaryRoot);

  let root = temporaryRoot;
  if (symlinked) {
    const realRoot = join(temporaryRoot, "real-project");
    root = join(temporaryRoot, "linked-project");
    mkdirSync(realRoot, { recursive: true });
    symlinkSync(realRoot, root, "dir");
  }

  mkdirSync(join(root, "src", "routes"), { recursive: true });

  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = join(root, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }

  return root;
}

afterEach(() => {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Vite client server-only boundary", () => {
  it("rejects a transitive server module imported through browser code", async () => {
    const root = makeProject({
      "src/client-entry.js": 'import "./browser.js";\n',
      "src/browser.js":
        'import { secret } from "./database.server.js";\nconsole.log(secret);\n',
      "src/database.server.js": 'export const secret = "DATABASE_SECRET";\n',
    });

    await expect(buildClient(root, "src/client-entry.js")).rejects.toThrow(
      /\[Goribu\].*database\.server\.js.*reached client code.*browser\.js.*Move the import into a route handler/s,
    );
  });

  it("tree-shakes an unused route import through a symlinked project root", async () => {
    const root = makeProject(
      {
        "src/routes/index.js":
          'import { secret } from "./handler.server.js";\nexport default "CLIENT_ENTRY_SURVIVES";\n',
        "src/routes/handler.server.js":
          'console.log("SERVER_SIDE_EFFECT_MUST_NOT_SURVIVE");\nexport const secret = "HANDLER_SECRET_MUST_NOT_SURVIVE";\n',
      },
      { symlinked: true },
    );
    expect(realpathSync(root)).not.toBe(root);

    const chunks = await buildClient(root, "src/routes/index.js");
    const source = chunks.map((chunk) => chunk.code).join("\n");
    const modules = chunks.flatMap((chunk) => Object.keys(chunk.modules));

    expect(source).toContain("CLIENT_ENTRY_SURVIVES");
    expect(source).not.toContain("SERVER_SIDE_EFFECT_MUST_NOT_SURVIVE");
    expect(source).not.toContain("HANDLER_SECRET_MUST_NOT_SURVIVE");
    expect(modules).not.toContain(
      realpathSync(join(root, "src", "routes", "handler.server.js")),
    );
  });

  it("audits a used route import through a symlinked project root", async () => {
    const root = makeProject(
      {
        "src/routes/index.js":
          'import { secret } from "./handler.server.js";\nexport default secret;\n',
        "src/routes/handler.server.js":
          'export const secret = "HANDLER_SECRET";\n',
      },
      { symlinked: true },
    );

    await expect(buildClient(root, "src/routes/index.js")).rejects.toThrow(
      /\[Goribu\].*handler\.server\.js.*reached client code.*generated client bundle/s,
    );
  });

  it("rejects case-variant server module names", async () => {
    const root = makeProject({
      "src/client-entry.js":
        'import { secret } from "./Database.Server.JS";\nconsole.log(secret);\n',
      "src/Database.Server.JS": 'export const secret = "CASE_SECRET";\n',
    });

    await expect(buildClient(root, "src/client-entry.js")).rejects.toThrow(
      /\[Goribu\].*Database\.Server\.JS.*reached client code.*client-entry\.js/s,
    );
  });
});

async function buildClient(root, entry) {
  const result = await build({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [
      createClientBoundaryPlugin({ routesDir: join(root, "src", "routes") }),
    ],
    build: {
      minify: false,
      write: false,
      rollupOptions: {
        input: join(root, entry),
        preserveEntrySignatures: "strict",
      },
    },
  });

  const outputs = Array.isArray(result) ? result : [result];
  return outputs.flatMap((output) =>
    output.output.filter((entry) => entry.type === "chunk"),
  );
}
