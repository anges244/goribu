import { execFileSync, fork } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
const cli = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));

function workerPids(parentPid) {
  return execFileSync("ps", ["-axo", "pid=,ppid=,comm="], { encoding: "utf8" })
    .trim().split("\n").flatMap((line) => {
      const [pid, parent, ...command] = line.trim().split(/\s+/);
      return Number(parent) === parentPid && /workerd/.test(command.join(" ")) ? [Number(pid)] : [];
    });
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

// Each session is a real `goribu dev` process against its own copy of the
// fixture, because the reported failure only appears when Vite, the Cloudflare
// plugin, and a live workerd child are all in play.
const sessions = new Set();

function startDevSession(initialOptions) {
  const root = mkdtempSync(join(tmpdir(), "goribu-dev-lifecycle-"));
  cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
  for (const name of ["package.json", "goribu.config.js"]) cpSync(join(fixture, name), join(root, name));
  symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
  initialOptions?.prepare?.(root);

  const session = { root, events: [], output: "", workers: new Set() };

  // Every server instance reports itself when it starts listening, so the test
  // can tell one restart from two and see how many listeners the process holds.
  // A plugin that throws from the earliest hook group Vite offers, placed either
  // side of goribu() so both the capturable and uncapturable orderings are real.
  const hostile = `{
    name: "hostile",
    enforce: "pre",
    configureServer: { order: "pre", handler() { throw new Error("setup hook failed"); } },
  }, `;

  session.configure = (
    revision,
    { server: serverOptions = '{ host: "127.0.0.1", port: 0 }', setup = "", failingPlugin } = {},
  ) =>
    writeFileSync(join(root, "vite.config.js"), `
import { goribu } from "goribu/vite";
export default {
  plugins: [${failingPlugin === "before" ? hostile : ""}goribu(), ${failingPlugin === "after" ? hostile : ""}{
    name: "observe-dev-listeners",
    configureServer(server) {
      ${setup}
      const listeners = globalThis.goribuTestListeners ??= [];
      listeners.push(server.httpServer);
      server.httpServer.once("listening", () => process.connected && process.send({
        revision: ${revision},
        port: server.httpServer.address().port,
        listeners: listeners.filter((listener) => listener.listening).length,
      }));
      server.middlewares.use((_request, response, next) => {
        response.setHeader("x-config-revision", "${revision}");
        next();
      });
    },
  }],
  server: ${serverOptions},
};
`);
  session.configure(0, initialOptions);

  const child = fork(cli, ["dev"], {
    cwd: root,
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  session.child = child;
  session.exited = once(child, "exit");
  child.stdout.on("data", (data) => { session.output += data; });
  child.stderr.on("data", (data) => { session.output += data; });
  child.on("message", (event) => session.events.push(event));

  session.check = (assertion) => {
    try { assertion(); }
    catch (error) { throw new Error(`${error.message}\nDev output:\n${session.output}`, { cause: error }); }
  };
  session.waitFor = (assertion, timeout = 30000) => vi.waitFor(() => {
    expect(session.output).not.toMatch(/Module runner already initialized|server restart failed/);
    assertion();
  }, { timeout, interval: 100 }).catch((error) => {
    throw new Error(`${error.message}\nDev output:\n${session.output}`, { cause: error });
  });
  // A generation is live once its server is listening; record its workerd child
  // so a later assertion can prove the previous one is gone.
  session.awaitGeneration = async (count) => {
    await session.waitFor(() => expect(session.events).toHaveLength(count));
    for (const pid of workerPids(child.pid)) session.workers.add(pid);
    return session.events.at(-1);
  };
  session.get = async (path, port) => fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(10000) });

  sessions.add(session);
  return session;
}

afterEach(async () => {
  for (const session of sessions) {
    const { child } = session;
    try {
      for (const pid of workerPids(child.pid)) session.workers.add(pid);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await session.exited;
      }
    }
    for (const pid of session.workers) if (isAlive(pid)) process.kill(pid, "SIGKILL");
    rmSync(session.root, { recursive: true, force: true });
  }
  sessions.clear();
});

it.each([".env", ".dev.vars"])("loads root %s bindings and reloads edits without leaking a generation", async (source) => {
  const session = startDevSession({ prepare(root) {
    writeFileSync(join(root, ".env"), "GORIBU_ENV_PROBE=base-value\nGORIBU_ENV_BASE_ONLY=base-only\nPUBLIC_ENV_PROBE=base-public\n");
    writeFileSync(join(root, ".env.local"), "GORIBU_ENV_PROBE=local-value\n");
    writeFileSync(join(root, ".env.development"), "GORIBU_ENV_MODE_ONLY=mode-only\nPUBLIC_ENV_PROBE=mode-public\n");
    writeFileSync(join(root, ".env.production"), "GORIBU_ENV_PROD_ONLY=production-only\n");
    if (source === ".dev.vars") writeFileSync(join(root, source), "GORIBU_ENV_PROBE=dev-vars-value\n");
    writeFileSync(join(root, "src/routes/env-probe.js"), `
export function GET(req, res) {
  return res.json({
    value: req.env.GORIBU_ENV_PROBE,
    base: req.env.GORIBU_ENV_BASE_ONLY ?? null,
    mode: req.env.GORIBU_ENV_MODE_ONLY ?? null,
    production: req.env.GORIBU_ENV_PROD_ONLY ?? null,
    public: import.meta.env.PUBLIC_ENV_PROBE,
  });
}
`);
  } });
  const { port } = await session.awaitGeneration(1);
  const expected = {
    value: source === ".env" ? "local-value" : "dev-vars-value",
    base: source === ".env" ? "base-only" : null,
    mode: null,
    production: null,
    public: "mode-public",
  };
  expect(await (await session.get("/env-probe", port)).json()).toEqual(expected);

  const configPath = join(session.root, "goribu.wrangler.jsonc");
  const generatedAt = statSync(configPath).mtimeMs;
  const filesToEdit = source === ".env" ? [".env", ".env.local"] : [".dev.vars"];
  for (const [index, file] of filesToEdit.entries()) {
    const value = `edited-${index}`;
    writeFileSync(join(session.root, file), `GORIBU_ENV_PROBE=${value}\nGORIBU_ENV_BASE_ONLY=base-only\n`);
    const event = await session.awaitGeneration(index + 2);
    expect(event).toMatchObject({ port, listeners: 1 });
    const workers = workerPids(session.child.pid);
    expect(workers).toHaveLength(1);
    expect([...session.workers].filter(isAlive)).toEqual(workers);
    expected.value = file === ".env" ? "local-value" : value;
    expected.base = "base-only";
    expect(await (await session.get("/env-probe", port)).json()).toEqual(expected);
    expect(statSync(configPath).mtimeMs).toBe(generatedAt);
  }

  // Both Vite and Cloudflare can observe .env. Let delayed events settle so an
  // accidental second restart cannot hide behind the first healthy response.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(session.events).toHaveLength(filesToEdit.length + 1);
  expect(existsSync(join(session.root, ".goribu/.dev.vars"))).toBe(false);
  expect(readFileSync(configPath, "utf8")).not.toMatch(/base-value|local-value|dev-vars-value|production-only/);
  for (const file of [".env", ".env.local", "goribu.wrangler.jsonc", ...(source === ".dev.vars" ? [source] : [])]) {
    const response = await session.get(`/@fs${join(session.root, file)}`, port);
    expect(response.status).toBe(403);
  }
  session.child.kill("SIGINT");
  await session.exited;
}, 120000);

it.each(["SIGINT", "SIGTERM"])(
  "restarts on one port with one workerd and releases both on %s",
  async (signal) => {
    const session = startDevSession();
    const generated = [join(session.root, "goribu.wrangler.jsonc"), join(session.root, ".goribu/worker.js")];
    let port;
    let generatedWrittenAt;

    for (let revision = 0; revision < 4; revision++) {
      if (revision) session.configure(revision);
      const event = await session.awaitGeneration(revision + 1);
      port ??= event.port;

      const workers = workerPids(session.child.pid);
      session.check(() => {
        // One restart per edit: regenerating `.goribu/` must not ask for another.
        expect(event).toMatchObject({ revision, port, listeners: 1 });
        expect(workers).toHaveLength(1);
        expect([...session.workers].filter(isAlive)).toEqual(workers);
        // `.goribu/` is rewritten only when its contents change, so an
        // unrelated restart leaves nothing for a watcher to react to.
        generatedWrittenAt ??= generated.map((file) => statSync(file).mtimeMs);
        expect(generated.map((file) => statSync(file).mtimeMs)).toEqual(generatedWrittenAt);
      });

      const response = await session.get("/greet?name=Restart", port);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-config-revision")).toBe(String(revision));
      expect(await response.text()).toContain("Restart");
    }

    session.child.kill(signal);
    await session.exited;
    await vi.waitFor(() => expect([...session.workers].filter(isAlive)).toEqual([]), { timeout: 5000 });
    await expect(session.get("/", port)).rejects.toThrow();
  },
  120000,
);

it("keeps serving the previous configuration when the replacement cannot load", async () => {
  const session = startDevSession();
  const { port } = await session.awaitGeneration(1);
  const [workerd] = workerPids(session.child.pid);

  writeFileSync(join(session.root, "vite.config.js"), "export default { broken syntax\n");
  await session.waitFor(() => expect(session.output).toContain("[Goribu] The development server did not restart and is still running"));

  session.check(() => {
    expect(session.output).toContain("Fix the error above and it will restart on its own");
    // Nothing was torn down, so there is no second generation and no new runtime.
    expect(session.events).toHaveLength(1);
    expect(workerPids(session.child.pid)).toEqual([workerd]);
  });
  const stillServing = await session.get("/greet?name=Broken", port);
  expect(stillServing.status).toBe(200);
  expect(stillServing.headers.get("x-config-revision")).toBe("0");

  // Repairing the file restarts the session without touching the process.
  session.configure(1);
  const repaired = await session.awaitGeneration(2);
  expect(repaired).toMatchObject({ revision: 1, port, listeners: 1 });
  const response = await session.get("/greet?name=Repaired", port);
  expect(response.headers.get("x-config-revision")).toBe("1");
  expect(await response.text()).toContain("Repaired");
}, 120000);

it("restarts when goribu.config.js changes", async () => {
  const session = startDevSession();
  const { port } = await session.awaitGeneration(1);
  const generated = join(session.root, "goribu.wrangler.jsonc");
  const readGenerated = () => JSON.parse(readFileSync(generated, "utf8").replace(/^\/\/[^\n]*\n/, ""));
  expect(readGenerated().name).toBe("goribu-basic-app");

  writeFileSync(
    join(session.root, "goribu.config.js"),
    readFileSync(join(session.root, "goribu.config.js"), "utf8")
      .replace('name: "goribu-basic-app"', 'name: "goribu-renamed-app"'),
  );

  const restarted = await session.awaitGeneration(2);
  // Regenerating `.goribu/` is what the change produces, so settle before
  // asserting that it produced one restart and not a second one behind it.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  session.check(() => {
    expect(session.events).toHaveLength(2);
    expect(session.output).toContain("goribu.config.js changed, restarting server...");
    expect(restarted).toMatchObject({ revision: 0, port, listeners: 1 });
    expect(readGenerated().name).toBe("goribu-renamed-app");
    expect(workerPids(session.child.pid)).toHaveLength(1);
  });
  expect((await session.get("/greet?name=Renamed", port)).status).toBe(200);
}, 120000);

it("refuses an application config it cannot accept and keeps the Worker serving", async () => {
  const session = startDevSession();
  const { port } = await session.awaitGeneration(1);
  const warm = await session.get("/greet?name=Before", port);
  expect(warm.status).toBe(200);

  // Loads as a module, so only Goribu's own validation can reject it.
  writeFileSync(join(session.root, "goribu.config.js"), "export default {};\n");
  await session.waitFor(() =>
    expect(session.output).toContain("[Goribu] The development server did not restart and is still running"));

  // The rejected config must not have reached the Worker through a hot update.
  const response = await session.get("/greet?name=After", port);
  session.check(() => {
    expect(session.events).toHaveLength(1);
    expect(workerPids(session.child.pid)).toHaveLength(1);
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("After");

  // Repairing it restarts the session in the same process.
  writeFileSync(
    join(session.root, "goribu.config.js"),
    'import { defineConfig } from "goribu/server";\n'
      + 'export default defineConfig({ name: "goribu-repaired-app", compatibilityDate: "2026-08-31", kv: { name: "goribu-basic-app-kv" } });\n',
  );
  expect(await session.awaitGeneration(2)).toMatchObject({ port, listeners: 1 });
  expect((await session.get("/greet?name=Repaired", port)).status).toBe(200);
}, 120000);

it("cleans up and reports when the replacement server cannot start", async () => {
  const occupied = createServer();
  await new Promise((ready) => occupied.listen(0, "127.0.0.1", ready));
  const occupiedPort = occupied.address().port;

  try {
    const session = startDevSession();
    const { port } = await session.awaitGeneration(1);
    expect((await session.get("/greet?name=Before", port)).status).toBe(200);
    const [workerd] = workerPids(session.child.pid);

    // Nothing about this config is wrong until a socket is asked for, so it
    // passes validation and fails while the replacement is taking over.
    session.child.disconnect();
    session.configure(1, { server: `{ host: "127.0.0.1", port: ${occupiedPort}, strictPort: true }` });

    await session.exited;
    session.check(() => {
      expect(session.output).toContain("[Goribu] The development server stopped because its replacement could not start");
      expect(session.output).not.toContain("Cannot print server URLs");
      // The runtime the half-built replacement started goes with it.
      expect(isAlive(workerd)).toBe(false);
      expect(workerPids(session.child.pid)).toEqual([]);
      expect(session.child.exitCode).toBe(1);
    });
    await expect(session.get("/", port)).rejects.toThrow();
  } finally {
    await new Promise((closed) => occupied.close(closed));
  }
}, 120000);

it("disposes a replacement that fails during setup", async () => {
  const session = startDevSession();
  const { port } = await session.awaitGeneration(1);
  expect((await session.get("/greet?name=Before", port)).status).toBe(200);
  const [workerd] = workerPids(session.child.pid);

  // Throwing from a setup hook is caught by Vite, which reports the failure and
  // drops the half-built server — watcher, Worker runtime and all.
  session.child.disconnect();
  session.configure(1, { setup: 'throw new Error("setup hook failed");' });

  await session.exited;
  session.check(() => {
    expect(session.output).toContain("setup hook failed");
    expect(session.output).toContain("[Goribu] The development server stopped because its replacement could not start");
    expect(isAlive(workerd)).toBe(false);
    expect(workerPids(session.child.pid)).toEqual([]);
    expect(session.child.exitCode).toBe(1);
  });
  await expect(session.get("/", port)).rejects.toThrow();
}, 120000);

it("disposes a first server that fails during setup", async () => {
  const session = startDevSession({ setup: 'throw new Error("setup hook failed");' });

  await session.exited;
  session.check(() => {
    expect(session.output).toContain("setup hook failed");
    expect(session.events).toEqual([]);
    expect(workerPids(session.child.pid)).toEqual([]);
    expect(session.child.exitCode).toBe(1);
  });
}, 120000);

// Hook order decides whether Goribu ever sees the server it has to clean up. A
// plugin declared before goribu() with the same enforce and hook order runs
// first, and then there is nothing to dispose — only a watcher Vite opened and
// no one can reach. The session has to end anyway rather than hang on it.
it.each(["before", "after"])(
  "ends a session when a setup hook declared %s goribu() throws",
  async (failingPlugin) => {
    const session = startDevSession({ failingPlugin });

    await session.exited;
    session.check(() => {
      expect(session.output).toContain("setup hook failed");
      expect(session.events).toEqual([]);
      expect(workerPids(session.child.pid)).toEqual([]);
      expect(session.child.exitCode).toBe(1);
    });
  },
  120000,
);
