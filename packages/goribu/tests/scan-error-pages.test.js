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
import { scanErrorPages } from "../src/routing/scan-error-pages.js";

const cleanupDirs = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("scanErrorPages", () => {
  it("discovers one top-level custom page for each error kind", () => {
    const routesDir = createRoutes({
      "_404.tsx": "export default function NotFound() {}",
      "_500.js": "export default function ServerError() {}",
      "index.jsx": "export default function Home() {}",
    });

    expect(scanErrorPages(routesDir)).toEqual({
      notFound: join(routesDir, "_404.tsx"),
      serverError: join(routesDir, "_500.js"),
    });
  });

  it("ignores nested, declaration, unsupported, and lookalike files", () => {
    const routesDir = createRoutes({
      "admin/_404.jsx": "export default function Nested() {}",
      "_404.d.ts": "export default function Declared(): void",
      "_404.css": "",
      "_404.backup.js": "export default function Backup() {}",
      "_500/index.jsx": "export default function Nested() {}",
      "_500.json": "{}",
    });

    expect(scanErrorPages(routesDir)).toEqual({
      notFound: null,
      serverError: null,
    });
  });

  it.skipIf(process.platform === "win32")(
    "does not follow symlinked custom error pages",
    () => {
      const routesDir = createRoutes({
        "_private/not-found.jsx": "export default function NotFound() {}",
      });
      symlinkSync(
        join(routesDir, "_private/not-found.jsx"),
        join(routesDir, "_404.jsx"),
      );

      expect(scanErrorPages(routesDir)).toEqual({
        notFound: null,
        serverError: null,
      });
    },
  );

  it("fails closed when more than one supported file owns an error page", () => {
    const routesDir = createRoutes({
      "_404.js": "export default function First() {}",
      "_404.tsx": "export default function Second() {}",
    });

    expect(() => scanErrorPages(routesDir)).toThrow(
      /\[Goribu\] Multiple _404 page modules were found:.*_404\.js.*_404\.tsx.*Keep exactly one/s,
    );
  });

  it("distinguishes an absent route tree from malformed scanner input", () => {
    const routesDir = createRoutes({ "index.js": "export function GET() {}" });

    expect(scanErrorPages(join(routesDir, "missing"))).toEqual({
      notFound: null,
      serverError: null,
    });
    expect(() => scanErrorPages(join(routesDir, "index.js"))).toThrow(
      /\[Goribu\].*not a directory.*src\/routes/s,
    );
    expect(() => scanErrorPages()).toThrow(
      "[Goribu] scanErrorPages(routesDir) requires the path to your src/routes directory",
    );
  });
});

function createRoutes(files) {
  const routesDir = mkdtempSync(join(tmpdir(), "goribu-error-pages-"));
  cleanupDirs.push(routesDir);

  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = join(routesDir, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }

  return routesDir;
}
