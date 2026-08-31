import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scanRoutes } from "../src/routing/scan-routes.js";

const cleanupDirs = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("scanRoutes", () => {
  it("discovers supported route modules recursively in deterministic order", () => {
    const routesDir = createRoutes({
      "z-last.tsx": "",
      "nested/b.jsx": "",
      "a.js": "",
      "nested/deeper/c.ts": "",
    });

    expect(scanRoutes(routesDir)).toEqual([
      route(routesDir, "a.js"),
      route(routesDir, "nested/b.jsx"),
      route(routesDir, "nested/deeper/c.ts"),
      route(routesDir, "z-last.tsx"),
    ]);
  });

  it("excludes reserved, declaration, and non-route files", () => {
    const routesDir = createRoutes({
      "d.ts": "",
      "index.jsx": "",
      "_middleware.js": "",
      "_private/visible.jsx": "",
      "nested/_draft.tsx": "",
      "types.d.ts": "",
      "styles.css": "",
    });

    expect(scanRoutes(routesDir)).toEqual([
      route(routesDir, "d.ts"),
      route(routesDir, "index.jsx"),
    ]);
  });

  it.skipIf(process.platform === "win32")(
    "does not follow symlinked route files or directories",
    () => {
      const routesDir = createRoutes({
        "index.js": "",
        "real/route.js": "",
        "_private/target.js": "",
      });
      symlinkSync(
        join(routesDir, "_private/target.js"),
        join(routesDir, "linked.js"),
      );
      symlinkSync(
        join(routesDir, "real"),
        join(routesDir, "linked-directory"),
        "dir",
      );

      expect(scanRoutes(routesDir)).toEqual([
        route(routesDir, "index.js"),
        route(routesDir, "real/route.js"),
      ]);
    },
  );

  it("distinguishes a missing route tree from a misconfigured path", () => {
    const routesDir = createRoutes({ "route.js": "" });

    expect(scanRoutes(join(routesDir, "missing"))).toEqual([]);
    expect(() => scanRoutes(join(routesDir, "route.js"))).toThrow(
      /\[Goribu\].*not a directory.*src\/routes/,
    );
  });
});

function createRoutes(files) {
  const routesDir = mkdtempSync(join(tmpdir(), "goribu-routes-"));
  cleanupDirs.push(routesDir);

  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = join(routesDir, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }

  return routesDir;
}

function route(routesDir, relativePath) {
  return {
    filePath: join(routesDir, relativePath),
    relativePath,
  };
}
