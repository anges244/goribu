import { execFileSync, spawn as nodeSpawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadApplicationConfig } from "./load-application-config.js";
import { resolveWranglerBin } from "./resolve-wrangler-bin.js";
import { CLOUDFLARE_AUTH_HELP, forwardWranglerDiagnostics } from "./wrangler-diagnostics.js";

/** Stream the configured production Worker's logs without a build or deploy. */
export async function runTail({ projectRoot, loadConfig = loadApplicationConfig, spawn = nodeSpawn,
  resolveBin = resolveWranglerBin, signals = process, stdout = process.stdout, stderr = process.stderr,
  shutdownTimeoutMs = 10_000 }) {
  const appConfig = await loadConfig({ projectRoot });
  let wranglerBin;
  try {
    wranglerBin = resolveBin();
  } catch (cause) {
    throw new Error("[Goribu] Could not find Wrangler for log streaming. Install dependencies (for example `pnpm install`), then rerun `goribu tail`.", { cause });
  }

  let workDir, child, stopping, shutdownTimer;
  let hungUp = false, forced = false;
  const writeDiagnostic = (text) => { if (!hungUp) stderr.write(text); };
  const stop = (signal) => {
    if (stopping) return;
    stopping = signal;
    child.kill(signal);
    shutdownTimer = setTimeout(() => {
      try {
        forceStop(child);
        forced = true;
        writeDiagnostic("[Goribu] Log streaming did not finish closing in time and was forcibly stopped. Remote session cleanup could not be confirmed; any remaining session will expire automatically.\n");
      } catch (error) {
        writeDiagnostic(`[Goribu] Could not force-stop Wrangler (PID ${child.pid}): ${error.message}. Stop that process and its children using your system's process manager.\n`);
      }
    }, shutdownTimeoutMs);
    shutdownTimer.unref();
  };
  const interrupt = () => stop("SIGINT");
  const terminate = () => stop("SIGTERM");
  const hangup = () => { hungUp = true; stop("SIGTERM"); };
  let result;
  try {
    // Explicit isolated config avoids stale build redirects, author Wrangler
    // files and local dotenv files. Shell credentials still reach Wrangler.
    workDir = mkdtempSync(join(tmpdir(), "goribu-tail-"));
    const configPath = join(workDir, "wrangler.json");
    writeFileSync(configPath, JSON.stringify({ name: appConfig.name }), "utf8");
    const args = [wranglerBin, "tail", appConfig.name, "--config", configPath, "--env", ""];
    if (stdout.isTTY) {
      args.unshift("--import", new URL("./tail-console.js", import.meta.url).href);
      args.push("--format", "json");
      stdout.write(`[Goribu] Opening live logs for Worker ${appConfig.name}. Press Ctrl+C to stop.\n`);
    }
    result = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, args, {
        cwd: workDir, stdio: ["inherit", "inherit", "pipe"],
        // Keep Wrangler out of the terminal's process group on POSIX. Goribu
        // forwards stop requests; terminal hangup must not cut off its cleanup.
        detached: process.platform !== "win32",
      });
      // A package manager may close the terminal before Wrangler finishes.
      // Keep draining stderr after hangup, but preserve diagnostics on Ctrl+C.
      forwardWranglerDiagnostics(child.stderr, { write: writeDiagnostic });
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal }));
      // Keep the parent alive until Wrangler closes its websocket and tail
      // session. Wrangler also handles terminal signals; its cleanup is idempotent.
      // A terminal and package manager can deliver the same signal twice, so
      // retain the handlers until the child closes rather than exiting early.
      signals.on("SIGINT", interrupt);
      signals.on("SIGTERM", terminate);
      signals.on("SIGHUP", hangup);
    });
  } catch (cause) {
    throw new Error(`[Goribu] Could not start log streaming for Worker ${appConfig.name}. Check that the temporary directory is writable and Node.js and Wrangler are accessible, then rerun \`goribu tail\`.`, { cause });
  } finally {
    signals.removeListener("SIGINT", interrupt);
    signals.removeListener("SIGTERM", terminate);
    signals.removeListener("SIGHUP", hangup);
    clearTimeout(shutdownTimer);
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  }

  if (forced) return 130;
  if (result.signal) {
    if (stopping && ["SIGINT", "SIGTERM"].includes(result.signal)) return 0;
    throw new Error(`[Goribu] Log streaming for Worker ${appConfig.name} ended unexpectedly with signal ${result.signal}. Rerun \`goribu tail\` to reconnect.`);
  }
  const code = result.code ?? 1;
  if (code !== 0) {
    writeDiagnostic(stopping
      ? `[Goribu] Log streaming for Worker ${appConfig.name} failed while closing (exit ${code}). Read the Wrangler error above and check connectivity. Remote cleanup could not be confirmed; any remaining session will expire automatically.\n`
      : `[Goribu] Could not continue log streaming for Worker ${appConfig.name} (exit ${code}). Read the Wrangler error above, confirm this Worker is deployed and CLOUDFLARE_ACCOUNT_ID selects the intended account, and check connectivity. ${CLOUDFLARE_AUTH_HELP}Then rerun \`goribu tail\`.\n`);
  }
  return code;
}

function forceStop(child) {
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 5_000 });
  } else {
    // Wrangler's launcher owns a child CLI. Kill their isolated process group,
    // not only the launcher, which cannot forward SIGKILL to the real CLI.
    try { process.kill(-child.pid, "SIGKILL"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
}
