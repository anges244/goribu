import { spawn as nodeSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolveWranglerBin } from "./resolve-wrangler-bin.js";
import { CLOUDFLARE_AUTH_HELP } from "./wrangler-diagnostics.js";

/** Read names through Wrangler only; never parse application env files. */
export async function listWorkerSecretNames(options) {
  let output;
  try {
    output = await runSecretCommand(options, "list");
  } catch (error) {
    // Wrangler reports a missing Worker as a failed command. Only an explicit
    // API not-found code can distinguish first deploy from denied access.
    if (options.allowMissingWorker && await isMissingWorker(options)) return Object.freeze([]);
    throw error;
  }
  let entries;
  try { entries = JSON.parse(output); } catch { throw secretError("read secret names"); }
  if (!Array.isArray(entries) || entries.some((entry) => typeof entry?.name !== "string" || !entry.name)) throw secretError("read secret names");
  return Object.freeze([...new Set(entries.map((entry) => entry.name))]);
}

async function isMissingWorker({ appConfig, access, fetch: fetchImpl = globalThis.fetch }) {
  try {
    const response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(access.accountId)}/workers/scripts/${encodeURIComponent(appConfig.name)}/settings`,
      { method: "GET", headers: access.headers, redirect: "error" },
    );
    const payload = await response.json();
    return response.status === 404 && payload?.success === false &&
      Array.isArray(payload.errors) && payload.errors.length === 1 && payload.errors[0]?.code === 10007;
  } catch {
    // Keep the original names-only inspection error; never include API output.
    return false;
  }
}

/** Read names to its pipe, pipe a generated GORIBU_SECRET, or "ask" through the terminal. */
export async function runSecretCommand(options, action, name = "GORIBU_SECRET") {
  const ask = action === "ask";
  const failure = action === "list" ? "read secret names" : ask ? `store ${name}` : "create GORIBU_SECRET";
  let child;
  try {
    child = (options.spawn ?? nodeSpawn)(process.execPath, [
      (options.resolveBin ?? resolveWranglerBin)(), "secret", ask ? "put" : action,
      ...(action === "list" ? ["--format", "json"] : [name]),
      "--name", options.appConfig.name,
    ], {
      cwd: options.projectRoot,
      // CI=true keeps Wrangler from prompting, except when asking is the point.
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: options.access.accountId,
        ...(ask ? {} : { CI: "true" }), WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false",
        WRANGLER_LOG_SANITIZE: "true", WRANGLER_LOG: action === "list" ? "log" : "error" },
      stdio: action === "list" ? ["ignore", "pipe", "ignore"] : ask ? ["inherit", "inherit", "ignore"] : ["pipe", "ignore", "ignore"],
    });
  } catch { throw secretError(failure, ask); }

  return new Promise((resolve, reject) => {
    let output = "", invalid = false;
    const fail = () => reject(secretError(failure, ask));
    child.on("error", fail);
    child.stdout?.on("data", (chunk) => {
      if (output.length + chunk.length > 1024 * 1024) { invalid = true; return; }
      output += String(chunk);
    });
    child.on("close", (code, signal) => {
      if (code !== 0 || signal || invalid) fail();
      else resolve(output);
    });
    if (action === "put") {
      if (!child.stdin) { fail(); return; }
      child.stdin.on("error", fail);
      try { child.stdin.end(`${randomBytes(32).toString("base64url")}\n`); } catch { fail(); }
    }
  });
}

export function secretError(action, asked = false) {
  return new Error(`[Goribu] Could not ${action} with Wrangler. ${asked ? "If you cancelled the prompt, rerun `goribu deploy` to be asked again. " : ""}${CLOUDFLARE_AUTH_HELP}Confirm Workers Scripts permissions and account access, then rerun \`goribu check\` before retrying deployment. If the Worker has an undeployed latest version, deploy that version from the Cloudflare dashboard first. Secret-command output is suppressed to keep values out of logs; Goribu did not delete or roll back any resources.`);
}
