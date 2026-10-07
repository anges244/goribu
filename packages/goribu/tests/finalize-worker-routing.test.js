import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { finalizeWorkerRouting } from "../src/build/finalize-worker-routing.js";

const created = [];
afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(files) {
  const root = mkdtempSync(join(tmpdir(), "goribu-routing-"));
  created.push(root);
  for (const [path, source] of Object.entries({
    ".goribu/dist/app/wrangler.json": JSON.stringify({ main: "index.js", assets: { directory: "../client", html_handling: "drop-trailing-slash" } }),
    ".goribu/dist/client/index.html": "HOME",
    ...files,
  })) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  const outputs = { configPath: join(root, ".goribu/dist/app/wrangler.json"), clientDir: join(root, ".goribu/dist/client") };
  return { root, outputs, config: () => JSON.parse(readFileSync(outputs.configPath, "utf8")) };
}

// The build-only Worker renders the miss page; the front door answers as the
// emitted asset routing would, here serving 404.html unless told otherwise.
function worker(response, frontDoor = () => html("MISS")) {
  const fetched = [];
  const startWorker = vi.fn(async (options) => ({
    fetch: async (pathname) => {
      fetched.push(`${options.frontDoor ? "front door" : "build"} ${pathname}`);
      return options.frontDoor ? frontDoor() : response();
    },
    stop: vi.fn(),
  }));
  return { startWorker, fetched };
}

const page = "export default function Page() { return null; }\n";
const html = (body, status = 404) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const log = () => ({ warn: vi.fn(), log: vi.fn() });

it("writes the built miss page and selective routing into the emitted configuration", async () => {
  const { root, outputs, config } = project({ "src/routes/index.jsx": page, "src/routes/subscribe.js": "export function POST() {}\n" });
  const { startWorker, fetched } = worker(() => html("MISS"));
  await finalizeWorkerRouting({ projectRoot: root, prerendered: [{ id: "src/routes/index.jsx" }], outputs, log: log(), startWorker });
  expect(fetched).toEqual(["build /_goribu/build/not-found", "front door /_goribu/build/not-found"]);
  expect(readFileSync(join(outputs.clientDir, "404.html"), "utf8")).toBe("MISS");
  expect(config().assets).toEqual({
    directory: "../client", html_handling: "drop-trailing-slash", not_found_handling: "404-page",
    run_worker_first: ["/404", "/_goribu/worker-nav", "/subscribe", "/subscribe/"],
  });
});

it("refuses another 404.html, at any depth, before rendering the miss page", async () => {
  for (const taken of ["404.html", "docs/404.html"]) {
    const { root, outputs } = project({ "src/routes/subscribe.js": "export function POST() {}\n", [`.goribu/dist/client/${taken}`]: "APP" });
    const { startWorker } = worker(() => html("MISS"));
    await expect(finalizeWorkerRouting({ projectRoot: root, prerendered: [], outputs, log: log(), startWorker }))
      .rejects.toThrow(new RegExp(`"${taken}" would replace the page served for unknown URLs.*src/routes/_404.jsx`));
    expect(startWorker).not.toHaveBeenCalled();
  }
});

it("fails the build when Static Assets does not serve the written miss page", async () => {
  const { root, outputs } = project({ "src/routes/subscribe.js": "export function POST() {}\n", ".goribu/dist/client/.assetsignore": "404.html\n" });
  const { startWorker } = worker(() => html("MISS"), () => new Response(null, { status: 404 }));
  await expect(finalizeWorkerRouting({ projectRoot: root, prerendered: [], outputs, log: log(), startWorker }))
    .rejects.toThrow(/does not serve the generated 404.html for unknown URLs.*public\/\.assetsignore/);
});

it("fails the build when the miss page cannot render without a request", async () => {
  const { root, outputs, config } = project({ "src/routes/_404.jsx": page, "src/routes/subscribe.js": "export function POST() {}\n" });
  const { startWorker } = worker(() => html("boom", 500));
  await expect(finalizeWorkerRouting({ projectRoot: root, prerendered: [], outputs, log: log(), startWorker }))
    .rejects.toThrow(/_404 page "src\/routes\/_404.jsx" responded 500 \(boom\).*must render without request data.*res\.notFound\(props\)/);
  expect(config().assets.run_worker_first).toBeUndefined();
});

it("keeps asset-first routing and Worker 404s under a root parameter", async () => {
  const { root, outputs, config } = project({ "src/routes/[slug].js": "export function GET() {}\n" });
  const { startWorker } = worker(() => html("MISS"));
  const output = log();
  await finalizeWorkerRouting({ projectRoot: root, prerendered: [], outputs, log: output, startWorker });
  expect(startWorker).not.toHaveBeenCalled();
  expect(config().assets).toEqual({ directory: "../client", html_handling: "drop-trailing-slash", not_found_handling: "none" });
  expect(output.warn).toHaveBeenCalledWith(expect.stringMatching(/Keeping asset-first routing/));
});
