import { statSync, watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { APPLICATION_CONFIG_FILENAME } from "./load-application-config.js";

// The server Vite is currently building, with the application-config watcher
// opened for it. A setup hook that throws is caught by Vite, which reports the
// failure and drops the half-built server on the floor — after it has opened a
// watcher and, once the Cloudflare plugin's own setup has run, started a workerd
// child. Nothing else holds a reference to it by then, and the post hook that
// would have tied the two together never runs, so both are recorded here as they
// are created and disposed together if the server never takes over.
let pending;

/**
 * Own how a development session restarts.
 *
 * Two things make a Goribu restart different from a plain Vite restart. The
 * Cloudflare plugin deliberately keeps one workerd runtime alive across a
 * restart, but its runner worker never forgets the module runner it registered
 * for an environment, so the replacement environments fail to initialize against
 * a retained runtime. And Vite builds the replacement server before closing the
 * old one, so two servers can briefly want the same port; when the replacement
 * fails that way, the listener that answered a moment ago is still bound and the
 * next attempt walks to the next free port.
 *
 * So the old runtime has to be gone before the replacement environments exist.
 * The only seam for that is outside the Cloudflare plugin's own restart wrapper,
 * because that wrapper is what tells its close hook to retain the runtime — and
 * `configureServer` post hooks run after every plugin's main hook body, which is
 * where Cloudflare installs its wrappers. Closing first would ordinarily mean a
 * config the replacement cannot load leaves nothing running, so the replacement
 * configuration is resolved before anything is torn down.
 */
export function createDevelopmentLifecyclePlugin() {
  let applicationConfig;

  return {
    name: "goribu:development-lifecycle",
    apply: "serve",
    // With the hook ordered "pre" as well, this captures before every hook Goribu
    // ships and before any application plugin declared after `goribu()`.
    enforce: "pre",

    configResolved(config) {
      applicationConfig = resolve(config.root, APPLICATION_CONFIG_FILENAME);
    },

    // `order: "pre"` puts this in the first group of configureServer hooks,
    // ahead of the Cloudflare plugin's and of every normal-order hook, so the
    // capture below covers a failure in any of them. It is a group and not a
    // guarantee: an application plugin declared before `goribu()` with the same
    // enforce and order runs first, and `endFailedSession` covers that. The
    // returned post hook still runs after every main hook, which is what the
    // wrappers need.
    configureServer: {
      order: "pre",
      handler(server) {
        const watcher = watchApplicationConfig(server, applicationConfig);
        pending = { server, watcher };

        // Post hook: Cloudflare has wrapped close and restart by now, so these
        // wrappers are the outermost ones and this close is not a restart's.
        return () => {
          const close = server.close.bind(server);
          server.close = async () => {
            watcher.close();
            return close();
          };

          const restart = server.restart.bind(server);
          let restarting;
          server.restart = (...args) => {
            restarting ??= runRestart(server, restart, args).finally(() => {
              restarting = undefined;
            });
            return restarting;
          };
        };
      },
    },
  };
}

/**
 * End a development session whose server never started.
 *
 * Disposes what Goribu captured of it, then makes sure the process actually
 * ends. Vite opens a watcher before the first plugin hook runs, so a hook that
 * throws ahead of the capture leaves a handle no one can reach and the process
 * would sit there with nothing listening. Nothing is serving by the time this
 * runs, so ending the session is the honest outcome either way.
 */
export async function endFailedSession(logger) {
  const disposed = await disposeAbandonedServer(logger);
  process.exitCode ||= 1;
  if (disposed) return;

  // Give the reported failure a chance to reach a pipe before the process goes.
  for (const stream of [process.stdout, process.stderr]) {
    if (stream.writable) await new Promise((flushed) => stream.write("", flushed));
  }
  process.exit();
}

/**
 * Dispose a server Vite built but never handed back.
 *
 * Vite reports a setup failure and returns without closing what it had already
 * built, so its watcher and Worker runtime would outlive the attempt. Safe to
 * call when there is nothing pending, and safe to call twice.
 */
async function disposeAbandonedServer(logger) {
  const abandoned = pending;
  pending = undefined;
  if (!abandoned) return false;

  try {
    abandoned.watcher.close();
    await abandoned.server.close();
  } catch (error) {
    const report = `[Goribu] A development server that failed to start could not be cleaned up: ${error?.message ?? error}. Check for a leftover \`workerd\` process before starting it again.`;
    if (logger) logger.error(report);
    else console.error(report);
  }

  return true;
}

/**
 * Make a `goribu dev` process end cleanly.
 *
 * Vite installs SIGTERM handling when it creates the server. Ctrl+C is left to
 * Node's default, which would end the process before the Cloudflare plugin
 * disposes Miniflare and leave a workerd child behind. One `once` listener is
 * the whole fix: Node restores the default signal behavior when the last
 * listener is removed, so a second Ctrl+C still ends a session whose shutdown
 * has wedged.
 */
export function installDevLifecycle(server) {
  // It started, so it is no longer a candidate for disposal; its watcher belongs
  // to the close wrapper now.
  pending = undefined;

  process.once("SIGINT", async () => {
    try {
      await server.close();
    } catch (error) {
      console.error(
        "[Goribu] The development server did not shut down cleanly. Check for a leftover `workerd` process before starting it again.",
        error,
      );
      process.exitCode = 1;
    } finally {
      process.exit();
    }
  });
}

/**
 * Restart when the application's own configuration file changes.
 *
 * Vite watches `vite.config.js` itself, and `goribu.config.js` is deliberately
 * kept out of Vite's watcher: the generated Worker entry imports it, so an
 * ordinary file event would invalidate it into the running Worker before
 * anything had decided Goribu accepts it. That leaves this the only thing
 * watching it, and the validated restart the only way its contents reach a
 * session.
 *
 * The directory is watched rather than the file, because an editor that saves by
 * replacing the file would leave a watch on the old one. Events are compared
 * against the last size and modification time seen, so a burst of them is one
 * restart and a touch that changed nothing is none.
 */
function watchApplicationConfig(server, applicationConfig) {
  const signature = () => {
    try {
      const { mtimeMs, size } = statSync(applicationConfig);
      return `${mtimeMs}:${size}`;
    } catch {
      // Deleted or unreadable is a change: the restart reports it properly.
      return "missing";
    }
  };

  let lastSeen = signature();
  const watcher = watch(dirname(applicationConfig), (_event, filename) => {
    // Some platforms report no filename; fall back to the signature check.
    if (filename && filename !== APPLICATION_CONFIG_FILENAME) return;
    const current = signature();
    if (current === lastSeen) return;
    lastSeen = current;

    server.config.logger.info(
      `${APPLICATION_CONFIG_FILENAME} changed, restarting server...`,
      { clear: true, timestamp: true },
    );
    server.restart();
  });
  // A watch failure must not take the session with it.
  watcher.on("error", (error) => {
    server.config.logger.error(
      `[Goribu] ${APPLICATION_CONFIG_FILENAME} is no longer being watched: ${error?.message ?? error}. Restart \`goribu dev\` to pick up changes to it.`,
    );
  });

  return watcher;
}

async function runRestart(server, restart, args) {
  const previous = { config: server.config, urls: server.resolvedUrls };

  if (!(await replacementConfigResolves(server))) return;

  await server.close();

  pending = undefined;
  try {
    await restart(...args);
  } catch (error) {
    // Vite swaps the replacement onto the server before it listens, so a failure
    // this late leaves a server that never started next to a Worker runtime that
    // did. Close what was built before reporting, or the session ends holding a
    // workerd child and no port. The error is reported here because callers are
    // watcher callbacks: rejecting would surface as an unhandled rejection.
    server.config.logger.error(`${error?.message ?? error}`, {
      timestamp: true,
      error: error instanceof Error ? error : undefined,
    });
    // Vite swapped the replacement onto the server before listening, so this
    // closes the replacement, not the session that was already gone.
    await closeReplacement(server);
    reportStopped(server, previous);
    await endFailedSession(server.config.logger);
    return;
  }

  // Vite reports a setup failure by logging rather than by rejecting, and leaves
  // the previous configuration in place when it does. Resolving the
  // configuration first rules out everything Goribu can see coming, so reaching
  // this means the replacement broke where only a live server could have caught
  // it — and Vite discarded that replacement without closing it.
  if (server.config === previous.config) {
    reportStopped(server, previous);
    await endFailedSession(server.config.logger);
    return;
  }

  pending = undefined;
}

async function closeReplacement(server) {
  try {
    await server.close();
  } catch (error) {
    server.config.logger.error(
      `[Goribu] The replacement development server could not be cleaned up: ${error?.message ?? error}. Check for a leftover \`workerd\` process before starting it again.`,
    );
  }
}

function reportStopped(server, previous) {
  // Nothing is serving now. Vite prints the server URLs after a restart that
  // changed them, and a replacement that never listened has none to print, so
  // the session's last known state goes back to leave that reporting with
  // nothing to say about a server that is gone. The repair instruction is then
  // the last thing printed, and the exit status says the session did not end by
  // request.
  server.config = previous.config;
  server.resolvedUrls = previous.urls;
  process.exitCode = 1;
  server.config.logger.error(
    "[Goribu] The development server stopped because its replacement could not start. Fix the error above, then run `goribu dev` again.",
  );
}

/**
 * Resolve the replacement configuration before anything is torn down.
 *
 * This runs the same config file load and the same plugin `config` and
 * `configResolved` hooks the restart is about to run, so it catches an
 * unparseable `vite.config.js` and Goribu's own build guards — no routes, a
 * duplicate binding, a reserved file under `public/` — while the current server
 * is still answering requests. Goribu's generators write only when their output
 * would change, so resolving twice touches nothing the watcher can see.
 */
async function replacementConfigResolves(server) {
  const { resolveConfig } = await import("vite");
  try {
    // A throwaway resolution should not narrate itself; the real one that
    // follows logs for real. resolveConfig fills in defaults on the config it is
    // given, so it gets a copy rather than the server's own inline config.
    await resolveConfig(
      { ...server.config.inlineConfig, logLevel: "silent", customLogger: undefined },
      "serve",
    );
    return true;
  } catch (error) {
    server.config.logger.error(
      `${error?.message ?? error}\n\n[Goribu] The development server did not restart and is still running. Fix the error above and it will restart on its own.`,
      { timestamp: true, error: error instanceof Error ? error : undefined },
    );
    return false;
  }
}
