import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
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
  for (const dir of ["dist", ".goribu", ".wrangler"]) {
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
    expect(build.output).toContain("Statically output 2 route(s)");
  });

  it("leaves the dynamic route to the Worker with no asset and a loud downgrade", () => {
    expect(existsSync(join(clientDir, "posts"))).toBe(false);
    expect(build.output).toContain('Route "src/routes/posts/[id].jsx" (/posts/:id) is a prerender candidate');
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
