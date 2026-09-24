// Run with an already installed Chrome/Chromium executable:
// node scripts/check-navigation-paint.js /path/to/chrome
// This standalone browser regression needs no browser package or server. Vite
// bundles the fixture in memory; CDP fulfills every fixture request in memory.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const executable = process.argv[2];
if (!executable || process.argv.length !== 3) {
  throw new Error("Pass an installed Chrome/Chromium executable: node scripts/check-navigation-paint.js /path/to/chrome. No installation or server is needed.");
}

const fixture = fileURLToPath(new URL("../packages/goribu/tests/fixtures/navigation-paint.js", import.meta.url));
const built = await build({
  root: fileURLToPath(new URL("../packages/goribu/", import.meta.url)),
  configFile: false,
  logLevel: "silent",
  build: {
    write: false,
    minify: false,
    rolldownOptions: { input: fixture, output: { codeSplitting: false } },
  },
});
const script = built.output.find((file) => file.type === "chunk" && file.isEntry).code;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Page a</title>
<style>
  body { margin: 0; font: 16px/1.5 Arial, sans-serif; background: #fff; }
  main { min-height: 5200px; padding: 24px; }
  h1 { margin: 0 0 24px; } h2 { scroll-margin-top: 80px; }
  pre { padding: 20px; background: #1b1b1b; color: #e4e4e7; }
  code { font: 13px/1.7 monospace; } .keyword { color: #aaa0de; }
  .space { height: 1700px; }
</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`;
const origin = "http://goribu-navigation.test";
const task = await mkdtemp(join(tmpdir(), "goribu-navigation-paint-"));
const profile = join(task, "chrome");
const report = { task, scenarios: [], errors: [], mutations: 0 };
const chrome = spawn(executable, [
  "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  "--disable-component-update", "--disable-sync", "about:blank",
], { stdio: "ignore" });
const exited = once(chrome, "exit");
let socket;
const pending = new Map();
let nextId = 0;
let slowRequest;
let holdSlow = false;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Chrome did not answer ${method}.`));
    }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function until(read, label) {
  const deadline = Date.now() + 15000;
  do {
    const result = await read();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}.`);
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function fulfill(requestId, body, contentType) {
  await send("Fetch.fulfillRequest", {
    requestId, responseCode: 200,
    responseHeaders: [{ name: "Content-Type", value: contentType }],
    body: Buffer.from(body).toString("base64"),
  });
}

async function serve({ requestId, request }) {
  const url = new URL(request.url);
  if (url.origin !== origin) return send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
  if (url.pathname === "/fixture.js") return fulfill(requestId, script, "text/javascript");
  if (url.pathname === "/mutation") {
    assert.equal(request.method, "POST");
    report.mutations += 1;
    return fulfill(requestId, JSON.stringify({ type: "redirect", to: "/b#target" }),
      "application/vnd.goribu.form+json");
  }
  if (url.pathname === "/_goribu/worker-nav") {
    const name = new URL(url.searchParams.get("to"), origin).pathname.slice(1);
    const response = () => fulfill(requestId, JSON.stringify({
      kind: "render", routeId: name, props: { name }, meta: { title: `Page ${name}` }, status: 200,
    }), "application/json");
    if (name === "slow" && holdSlow) { slowRequest = response; return; }
    return response();
  }
  if (url.pathname === "/favicon.ico") return fulfill(requestId, "", "image/x-icon");
  return fulfill(requestId, html, "text/html");
}

async function settleFrames() {
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))");
}

async function beginAt(y) {
  await evaluate(`scrollTo(0, ${y}); navigationPaint.controller.saveScroll();`);
  await settleFrames();
  await evaluate("navigationPaint.frames = []");
}

async function inspect(label, destination, expected, action) {
  await action();
  await until(() => evaluate(`document.querySelector('[data-page]')?.dataset.page === ${JSON.stringify(destination)} &&
    ${expected.hash === undefined ? "true" : `location.hash === ${JSON.stringify(expected.hash)}`}`), label);
  await settleFrames();
  const frames = await evaluate("navigationPaint.frames");
  const targetFrames = frames.filter((frame) => frame.page === destination &&
    (expected.hash === undefined || frame.hash === expected.hash));
  assert(targetFrames.length, `${label}: no destination frames captured`);
  const invalid = targetFrames.filter((frame) =>
    !Number.isFinite(frame[expected.field]) ||
    Math.abs(frame[expected.field] - expected.value) > 1 ||
    frame.codeBackground !== "rgb(27, 27, 27)" || frame.keywordColor !== "rgb(170, 160, 222)");
  report.scenarios.push({ label, expected, frames, invalid });
  assert.equal(invalid.length, 0,
    `${label}: destination appeared at the wrong scroll position or without code styles: ${JSON.stringify(invalid)}`);
}

try {
  const port = await until(async () => {
    try { return (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; }
    catch { return null; }
  }, "Chrome startup");
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await once(socket, "open");
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    } else if (message.method === "Fetch.requestPaused") {
      serve(message.params).catch((error) => report.errors.push(String(error)));
    } else if (message.method === "Runtime.exceptionThrown") {
      report.errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      report.errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
    }
  });
  await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Fetch.enable", { patterns: [{ urlPattern: "*" }] })]);
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${origin}/a` });
  await until(() => evaluate("Boolean(window.navigationPaint)"), "fixture startup");

  await beginAt(900);
  await inspect("new page starts at top", "b", { field: "scrollY", value: 0 },
    () => evaluate("navigationPaint.controller.navigate('/b')"));

  await beginAt(1100);
  await inspect("cross-page fragment", "a", { field: "anchorTop", value: 80 },
    () => evaluate("navigationPaint.controller.navigate('/a#target')"));
  const fragmentScroll = await evaluate("scrollY");

  await beginAt(fragmentScroll);
  await inspect("Back restores saved position", "b", { field: "scrollY", value: 1100 },
    () => evaluate("history.back()"));

  await beginAt(1100);
  await inspect("Forward restores fragment position", "a", { field: "scrollY", value: fragmentScroll },
    () => evaluate("history.forward()"));

  const historyLength = await evaluate("history.length");
  await beginAt(fragmentScroll);
  await inspect("replace starts at top", "b", { field: "scrollY", value: 0 },
    () => evaluate("navigationPaint.controller.navigate('/b', { replace: true })"));
  assert.equal(await evaluate("history.length"), historyLength);

  await beginAt(800);
  await inspect("native same-page fragment", "b", { field: "anchorTop", value: 80, hash: "#target" },
    () => evaluate("location.hash = 'target'; void 0"));
  const samePageFragmentScroll = await evaluate("scrollY");

  await beginAt(samePageFragmentScroll);
  await inspect("same-page Back restores saved position", "b", { field: "scrollY", value: 800, hash: "" },
    () => evaluate("history.back()"));

  await beginAt(800);
  await inspect("same-page Forward restores fragment position", "b", { field: "scrollY", value: samePageFragmentScroll, hash: "#target" },
    () => evaluate("history.forward()"));

  await beginAt(900);
  holdSlow = true;
  await evaluate("window.olderNavigation = navigationPaint.controller.navigate('/slow'); void 0");
  await until(() => slowRequest, "delayed navigation request");
  await inspect("newer navigation owns the page and scroll", "a", { field: "scrollY", value: 0 },
    () => evaluate("navigationPaint.controller.navigate('/a')"));
  await slowRequest();
  await evaluate("olderNavigation");
  await settleFrames();
  assert.equal(await evaluate("navigationPaint.frames.some(frame => frame.page === 'slow')"), false);
  assert.equal(await evaluate("document.title"), "Page a");

  await beginAt(900);
  await inspect("fragment added by a layout effect", "layout", { field: "anchorTop", value: 80 },
    () => evaluate("navigationPaint.controller.navigate('/layout#target')"));

  await evaluate("navigationPaint.controller.navigate('/form')");
  await beginAt(900);
  await inspect("Form redirect scrolls after the submitting form unmounts", "b", { field: "anchorTop", value: 80 },
    () => evaluate("document.getElementById('mutation-submit').click()"));

  await evaluate("navigationPaint.controller.navigate('/form')");
  await beginAt(900);
  await inspect("GET Form scrolls after the submitting form unmounts", "b", { field: "scrollY", value: 0 },
    () => evaluate("document.getElementById('get-submit').click()"));
  assert.equal(report.mutations, 1, "the form mutation must not be replayed");
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(`Passed ${report.scenarios.length} navigation paint scenarios without a server.`);
} catch (error) {
  report.failure = String(error);
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      const screenshot = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(join(task, "failure.png"), Buffer.from(screenshot.data, "base64"));
    } catch { /* Keep the original failure if the browser has exited. */ }
  }
  throw error;
} finally {
  await writeFile(join(task, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`Browser evidence: ${join(task, "report.json")}`);
  for (const waiter of pending.values()) clearTimeout(waiter.timer);
  socket?.close();
  chrome.kill("SIGTERM");
  const timer = setTimeout(() => chrome.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
  await rm(profile, { recursive: true, force: true });
}
