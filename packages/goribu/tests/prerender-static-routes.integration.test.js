import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createTestHarness } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A real end-to-end exercise of the static-output boundary: it runs the actual
// `goribu build` on the fixture app, which builds the Worker and client bundles
// and then runs the emitted Worker in workerd to produce static HTML. Nothing is
// stubbed — this proves the workerd render path, not just the orchestration.

const cliPath = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));
const appDir = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
const clientDir = join(appDir, "dist", "client");
const workerConfig = join(appDir, "dist", "goribu_basic_app", "wrangler.json");

let build;

function cleanBuildOutput() {
  for (const dir of ["dist", ".goribu", ".wrangler", "goribu.wrangler.jsonc"]) {
    rmSync(join(appDir, dir), { recursive: true, force: true });
  }
}

beforeAll(() => {
  cleanBuildOutput();
  // spawnSync blocks the event loop, so Vitest's hook timeout cannot interrupt a
  // hung build. Bound the child directly and surface a spawn/kill error.
  const result = spawnSync(process.execPath, [cliPath, "build"], {
    cwd: appDir,
    encoding: "utf8",
    timeout: 100000,
  });
  build = {
    status: result.status,
    error: result.error,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}, 120000);

afterAll(() => {
  cleanBuildOutput();
});

describe("goribu build static output (workerd)", () => {
  it("builds successfully", () => {
    expect(build.error, String(build.error)).toBeUndefined();
    expect(build.status, build.output).toBe(0);
  });

  it("writes static HTML the Worker rendered for each static route", () => {
    expect(existsSync(join(clientDir, "index.html"))).toBe(true);
    expect(existsSync(join(clientDir, "about.html"))).toBe(true);
    expect(readFileSync(join(clientDir, "index.html"), "utf8")).toContain("Hello from Goribu");
    expect(readFileSync(join(clientDir, "about.html"), "utf8")).toContain("<h1>About</h1>");
    expect(existsSync(join(clientDir, "forms.html"))).toBe(false);
    expect(build.output).toContain("Statically output 2 route(s)");
  });

  it("keeps middleware-free pages static and middleware routes on the Worker", () => {
    expect(existsSync(join(clientDir, "index.html"))).toBe(true);
    expect(existsSync(join(clientDir, "about.html"))).toBe(true);
    expect(existsSync(join(clientDir, "posts"))).toBe(false);
    expect(build.output).toContain(
      'Route "src/routes/posts/[id].jsx" (/posts/:id) is a prerender candidate',
    );
    expect(build.output).toContain(
      'Route "src/routes/posts/demo/index.jsx" (/posts/demo) is a prerender candidate',
    );
    expect(build.output).toContain("src/routes/posts/_middleware.js");
    expect(build.output).toContain("src/routes/posts/demo/_middleware.js");
    expect(
      readdirSync(clientDir, { recursive: true }).some((file) =>
        /\.server\./i.test(file),
      ),
    ).toBe(false);
  });

  it("passes Worker bindings and a bound waitUntil capability to a fixture handler", async () => {
    const harness = createTestHarness({ workers: [{ configPath: workerConfig }] });
    await harness.listen();
    const worker = harness.getWorker();
    try {
      const response = await worker.fetch("https://goribu.test/hello");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        hasAssets: true,
        hasServerToken: true,
      });
    } finally {
      await harness.close();
    }
  });

  it("reaches colocated mutation handlers through the production HTTP server", async () => {
    const harness = createTestHarness({ workers: [{ configPath: workerConfig }] });
    try {
      const { url } = await harness.listen();
      // getWorker().fetch() bypasses Static Assets routing and would miss a
      // prerendered page shadowing these handlers at the public URL.
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        for (const accept of ["text/html", "application/vnd.goribu.form+json"]) {
          for (const multipart of [false, true]) {
            const body = multipart ? new FormData() : new URLSearchParams();
            body.append("name", "Ada");
            body.append("intent", "save");
            if (multipart) body.append("attachment", new File(["upload"], "note.txt", { type: "text/plain" }));
            const response = await fetch(new URL("/forms", url), {
              method,
              headers: { accept },
              body,
            });
            expect(response.status, `${method} with Accept: ${accept}`).toBe(201);
            const result = await response.json();
            expect(accept === "text/html" ? result : result.data).toMatchObject({
              method, name: "Ada", attachment: multipart ? "note.txt" : null,
            });
          }
        }
      }
    } finally {
      await harness.close();
    }
  });

  it("runs selected fixture middleware outermost-first in the emitted Worker", async () => {
    const harness = createTestHarness({ workers: [{ configPath: workerConfig }] });
    await harness.listen();
    const worker = harness.getWorker();
    try {
      const page = await worker.fetch("https://goribu.test/posts/demo");
      expect(page.status).toBe(200);
      expect(page.headers.get("x-posts-middleware")).toBe("yes");
      expect(page.headers.get("x-demo-middleware")).toBe("yes");
      expect(page.headers.get("x-middleware-order")).toBe(
        "posts,posts-gate,demo",
      );
      expect(await page.text()).toContain("<h1>Middleware demo</h1>");

      const response = await worker.fetch(
        "https://goribu.test/posts/demo/middleware",
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("x-posts-middleware")).toBe("yes");
      expect(response.headers.get("x-demo-middleware")).toBe("yes");
      expect(response.headers.get("x-handler")).toBe("yes");
      expect(await response.json()).toEqual({
        middleware: ["posts", "posts-gate", "demo"],
      });

      const stopped = await worker.fetch(
        "https://goribu.test/posts/demo/middleware?middleware=demo",
        { redirect: "manual" },
      );
      expect(stopped.status).toBe(303);
      expect(stopped.headers.get("location")).toBe("/login");
      expect(stopped.headers.get("x-posts-middleware")).toBe("yes");
      expect(stopped.headers.get("x-demo-middleware")).toBe("yes");
      expect(stopped.headers.get("x-handler")).toBeNull();
    } finally {
      await harness.close();
    }
  });

  it("round-trips req.kv values, TTL, metadata, cursors, and deletion in the emitted Worker", async () => {
    const config = JSON.parse(readFileSync(workerConfig, "utf8"));
    expect(config.kv_namespaces).toEqual([
      expect.objectContaining({ binding: "KV", preview_id: "goribu-basic-app-kv" }),
    ]);
    const harness = createTestHarness({ workers: [{ configPath: workerConfig }] });
    await harness.listen();
    try {
      const worker = harness.getWorker();
      const stored = await worker.fetch("https://goribu.test/kv", { method: "POST", body: "local namespace proof" });
      expect(stored.status).toBe(200);
      const response = await worker.fetch("https://goribu.test/kv");
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ value: "local namespace proof" });

      const before = Math.floor(Date.now() / 1000);
      for (const key of ["runtime:a", "runtime:b"]) {
        const result = await worker.fetch(`https://goribu.test/kv?key=${key}`, {
          method: "POST", body: JSON.stringify({ key }),
        });
        expect(result.status).toBe(200);
      }
      const withMetadata = await worker.fetch("https://goribu.test/kv?key=runtime:a&metadata");
      expect(withMetadata.status).toBe(200);
      expect(await withMetadata.json()).toMatchObject({ value: { key: "runtime:a" }, metadata: { source: "fixture" } });
      let page = await (await worker.fetch("https://goribu.test/kv?list&prefix=runtime:")).json();
      expect(page.keys).toHaveLength(1);
      expect(page.list_complete).toBe(false);
      expect(page.keys[0]).toMatchObject({ name: "runtime:a", metadata: { source: "fixture" } });
      expect(page.keys[0].expiration).toBeGreaterThanOrEqual(before + 120);
      expect(page.keys[0].expiration).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 120);
      page = await (await worker.fetch(`https://goribu.test/kv?list&prefix=runtime:&cursor=${encodeURIComponent(page.cursor)}`)).json();
      expect(page.keys.map((key) => key.name)).toEqual(["runtime:b"]);
      expect(page.list_complete).toBe(true);
      const deleted = await worker.fetch("https://goribu.test/kv?key=runtime:a", { method: "DELETE" });
      expect(deleted.status).toBe(200);
      expect(await deleted.text()).toBe("Deleted");
      const missing = await worker.fetch("https://goribu.test/kv?key=runtime:a&metadata");
      expect(await missing.json()).toMatchObject({ value: null, metadata: null });
    } finally {
      await harness.close();
    }
  });

  it("uses the production _500 boundary and preserves safe HttpError responses", async () => {
    const harness = createTestHarness({ workers: [{ configPath: workerConfig }] });
    await harness.listen();
    const worker = harness.getWorker();
    try {
      const failed = await worker.fetch("https://goribu.test/boom");
      const html = await failed.text();
      const errorId = html.match(/Error reference: <code>([^<]+)<\/code>/)?.[1];

      expect(failed.status).toBe(500);
      expect(failed.headers.get("content-type")).toBe(
        "text/html; charset=utf-8",
      );
      expect(errorId).toEqual(expect.any(String));
      expect(errorId.length).toBeGreaterThan(0);
      expect(html).not.toContain("fixture boom secret");
      expect(html).not.toContain("at GET");

      // The emitted Worker is production-mode. Development stack disclosure is
      // covered in create-app.test.js instead of being expected from this build.
      const clientError = await worker.fetch(
        "https://goribu.test/boom?http=1",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{ broken",
        },
      );
      const message = await clientError.text();

      expect(clientError.status).toBe(400);
      expect(clientError.headers.get("content-type")).toBe(
        "text/plain; charset=utf-8",
      );
      expect(message).toContain(
        "[Goribu] Could not parse the application/json request body. Send valid JSON",
      );
      expect(message).not.toContain("SyntaxError");
    } finally {
      await harness.close();
    }
  });

  it("matches the static HTML byte-for-byte with what the Worker serves in workerd", async () => {
    const harness = createTestHarness({ workers: [{ configPath: workerConfig }] });
    await harness.listen();
    const worker = harness.getWorker();
    try {
      for (const [file, path] of [["index.html", "/"], ["about.html", "/about"]]) {
        // The direct Worker handle bypasses the Static Assets front door, so this
        // compares the written file against a fresh Worker render, not the file
        // being served back to itself.
        const served = await (await worker.fetch(`https://goribu.test${path}`)).text();
        expect(readFileSync(join(clientDir, file), "utf8")).toBe(served);
      }
    } finally {
      await harness.close();
    }
  });
});
