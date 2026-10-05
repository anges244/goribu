import { spawn as nodeSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolveWranglerBin } from "./resolve-wrangler-bin.js";
import { createR2ManagementClient } from "./cloudflare-r2.js";
import { R2_UPLOAD_KEYS } from "./inspect-r2-uploads.js";
import { CLOUDFLARE_AUTH_HELP } from "./wrangler-diagnostics.js";

const KEY_LABELS = { R2_ACCESS_KEY_ID: "Access Key ID", R2_SECRET_ACCESS_KEY: "Secret Access Key" };

/** Match when Wrangler's `secret put` prompts: both streams are terminals, outside CI. */
export function canPromptForSecrets() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && [undefined, "", "false"].includes(process.env.CI);
}

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

/**
 * Ask the person at the terminal for missing direct-upload keys. Wrangler's own
 * hidden prompt reads each value, so Goribu never sees, stores or logs one.
 * Runs after the signing secret, so the Worker (or its draft) already exists.
 */
export async function ensureR2UploadKeys(options) {
  const stdout = options.stdout ?? process.stdout;
  const names = await listR2SecretNames(options);
  const missing = R2_UPLOAD_KEYS.filter((name) => !names.includes(name));
  if (!missing.length) return;
  stdout.write("\nR2 direct uploads need an R2 API token. Create one now:\n" +
    `  1. Open https://dash.cloudflare.com/${options.access.accountId}/r2/api-tokens and create an API token.\n` +
    // The plan has one upload CORS entry per direct-upload bucket.
    `  2. Permissions: Object Read & Write. Apply it to: ${options.uploads.cors.map((entry) => `${entry.bucket} (${entry.jurisdiction})`).join(", ")}.\n` +
    "  3. Paste each value below when asked. The input stays hidden.\n");
  for (const name of missing) {
    stdout.write(`${name}: the token's ${KEY_LABELS[name]}\n`);
    await runSecretCommand(options, "ask", name);
  }
  const stored = await listR2SecretNames(options);
  if (missing.some((name) => !stored.includes(name))) throw secretError(`confirm ${missing.join(" and ")}`, true);
  stdout.write(`✓ Stored Worker secrets ${missing.join(" and ")}\n`);
}

/** Read names to its pipe, pipe a generated GORIBU_SECRET, or "ask" through the terminal. */
async function runSecretCommand(options, action, name = "GORIBU_SECRET") {
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

function secretError(action, asked = false) {
  return new Error(`[Goribu] Could not ${action} with Wrangler. ${asked ? "If you cancelled the prompt, rerun `goribu deploy` to be asked again. " : ""}${CLOUDFLARE_AUTH_HELP}Confirm Workers Scripts permissions and account access, then rerun \`goribu check\` before retrying deployment. If the Worker has an undeployed latest version, deploy that version from the Cloudflare dashboard first. Secret-command output is suppressed to keep values out of logs; Goribu did not delete or roll back any resources.`);
}
