import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scanMiddleware } from "../src/routing/scan-middleware.js";

const cleanupDirs = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("scanMiddleware", () => {
  it("discovers one executable middleware module per routable directory", () => {
    const routesDir = createRoutes({
      "_middleware.ts": "export default function root() {}",
      "admin/_middleware.jsx": "export default function admin() {}",
      "admin/posts/_middleware.js": "export default function posts() {}",
      "admin/posts/index.jsx": "export default function Posts() {}",
      "public/index.js": "export function GET() {}",
    });

    expect(scanMiddleware(routesDir)).toEqual([
      {
        filePath: join(routesDir, "_middleware.ts"),
        relativePath: "_middleware.ts",
      },
      {
        filePath: join(routesDir, "admin/_middleware.jsx"),
        relativePath: "admin/_middleware.jsx",
      },
      {
        filePath: join(routesDir, "admin/posts/_middleware.js"),
        relativePath: "admin/posts/_middleware.js",
      },
    ]);
  });

  it("ignores declarations, lookalikes, unsupported files, and reserved subtrees", () => {
    const routesDir = createRoutes({
      "_middleware.d.ts": "export default function declared(): void",
      "_middleware.css": "",
      "_middleware.backup.js": "export default function backup() {}",
      "_middleware/index.js": "export default function nested() {}",
      "admin/_private/_middleware.ts": "export default function hidden() {}",
      "admin/_middleware.json": "{}",
    });

    expect(scanMiddleware(routesDir)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "does not follow symlinked middleware files or directories",
    () => {
      const routesDir = createRoutes({
        "_private/root.js": "export default function root() {}",
        "_private/nested/_middleware.js": "export default function nested() {}",
      });
      symlinkSync(
        join(routesDir, "_private/root.js"),
        join(routesDir, "_middleware.js"),
      );
      symlinkSync(
        join(routesDir, "_private/nested"),
        join(routesDir, "linked"),
      );

      expect(scanMiddleware(routesDir)).toEqual([]);
    },
  );

  it("fails closed when one directory has multiple middleware modules", () => {
    const routesDir = createRoutes({
      "admin/_middleware.js": "export default function first() {}",
      "admin/_middleware.tsx": "export default function second() {}",
    });

    expect(() => scanMiddleware(routesDir)).toThrow(
      /\[Goribu\] Multiple _middleware modules were found in .*admin.*_middleware\.js.*_middleware\.tsx.*Keep exactly one/s,
    );
  });

  it("distinguishes an absent route tree from malformed scanner input", () => {
    const routesDir = createRoutes({ "index.js": "export function GET() {}" });

    expect(scanMiddleware(join(routesDir, "missing"))).toEqual([]);
    expect(() => scanMiddleware(join(routesDir, "index.js"))).toThrow(
      /\[Goribu\].*not a directory.*src\/routes/s,
    );
    expect(() => scanMiddleware()).toThrow(
      "[Goribu] scanMiddleware(routesDir) requires the path to your src/routes directory",
    );
  });
});

function createRoutes(files) {
  const routesDir = mkdtempSync(join(tmpdir(), "goribu-middleware-"));
  cleanupDirs.push(routesDir);

  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = join(routesDir, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }

  return routesDir;
}
