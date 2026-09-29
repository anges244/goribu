import { spawn as nodeSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolveWranglerBin } from "./resolve-wrangler-bin.js";
import { createR2ManagementClient } from "./cloudflare-r2.js";
import { CLOUDFLARE_AUTH_HELP } from "./wrangler-diagnostics.js";

/** Read names through Wrangler only; never parse application env files. */
export async function listR2SecretNames(options) {
  const output = await runSecretCommand(options, "list");
  let entries;
  try { entries = JSON.parse(output); } catch { throw secretError("read secret names"); }
  if (!Array.isArray(entries) || entries.some((entry) => typeof entry?.name !== "string" || !entry.name)) throw secretError("read secret names");
  return Object.freeze([...new Set(entries.map((entry) => entry.name))]);
}

/** Recheck just before creating; pass a fresh secret directly to Wrangler stdin. */
export async function ensureR2SigningSecret(options) {
  if (options.appConfig.r2 === undefined) return;
  const client = createR2ManagementClient({ access: options.access, fetch: options.fetch });
  const worker = await client.worker(options.appConfig.name);
  const names = worker.exists ? await listR2SecretNames(options) : [];
  if (names.includes("GORIBU_SECRET")) return;
  await runSecretCommand(options, "put");
  // A successful process exit alone could mean a cancelled draft-Worker prompt.
  if (!(await listR2SecretNames(options)).includes("GORIBU_SECRET")) throw secretError("confirm GORIBU_SECRET creation");
  (options.stdout ?? process.stdout).write("✓ Created Worker secret GORIBU_SECRET\n");
}

async function runSecretCommand(options, action) {
  let child;
  try {
    child = (options.spawn ?? nodeSpawn)(process.execPath, [
      (options.resolveBin ?? resolveWranglerBin)(), "secret", action,
      ...(action === "put" ? ["GORIBU_SECRET"] : ["--format", "json"]),
      "--name", options.appConfig.name,
    ], {
      cwd: options.projectRoot,
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: options.access.accountId,
        CI: "true", WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false",
        WRANGLER_LOG_SANITIZE: "true", WRANGLER_LOG: action === "put" ? "error" : "log" },
      stdio: action === "put" ? ["pipe", "ignore", "ignore"] : ["ignore", "pipe", "ignore"],
    });
  } catch { throw secretError(action === "put" ? "create GORIBU_SECRET" : "read secret names"); }

  return new Promise((resolve, reject) => {
    let output = "", invalid = false;
    const fail = () => reject(secretError(action === "put" ? "create GORIBU_SECRET" : "read secret names"));
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

function secretError(action) {
  return new Error(`[Goribu] Could not ${action} with Wrangler. ${CLOUDFLARE_AUTH_HELP}Confirm Workers Scripts permissions and account access, then rerun \`goribu check\` before retrying deployment. If the Worker has an undeployed latest version, deploy that version from the Cloudflare dashboard first. Secret-command output is suppressed to keep values out of logs; Goribu did not delete or roll back any resources.`);
}
