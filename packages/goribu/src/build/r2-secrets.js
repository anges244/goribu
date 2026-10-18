import { createR2ManagementClient } from "./cloudflare-r2.js";
import { R2_UPLOAD_KEYS } from "./inspect-r2-uploads.js";
import { listWorkerSecretNames, runSecretCommand, secretError } from "./worker-secrets.js";

const KEY_LABELS = { R2_ACCESS_KEY_ID: "Access Key ID", R2_SECRET_ACCESS_KEY: "Secret Access Key" };

/** Match when Wrangler's `secret put` prompts: both streams are terminals, outside CI. */
export function canPromptForSecrets() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && [undefined, "", "false"].includes(process.env.CI);
}

/** Recheck just before creating; pass a fresh secret directly to Wrangler stdin. */
export async function ensureR2SigningSecret(options) {
  if (options.appConfig.r2 === undefined) return;
  const client = createR2ManagementClient({ access: options.access, fetch: options.fetch });
  const worker = await client.worker(options.appConfig.name);
  const names = worker.exists ? await listWorkerSecretNames(options) : [];
  if (names.includes("GORIBU_SECRET")) return;
  await runSecretCommand(options, "put");
  // A successful process exit alone could mean a cancelled draft-Worker prompt.
  if (!(await listWorkerSecretNames(options)).includes("GORIBU_SECRET")) throw secretError("confirm GORIBU_SECRET creation");
  (options.stdout ?? process.stdout).write("✓ Created Worker secret GORIBU_SECRET\n");
}

/**
 * Ask the person at the terminal for missing direct-upload keys. Wrangler's own
 * hidden prompt reads each value, so Goribu never sees, stores or logs one.
 * Runs after the signing secret, so the Worker (or its draft) already exists.
 */
export async function ensureR2UploadKeys(options) {
  const stdout = options.stdout ?? process.stdout;
  const names = await listWorkerSecretNames(options);
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
  const stored = await listWorkerSecretNames(options);
  if (missing.some((name) => !stored.includes(name))) throw secretError(`confirm ${missing.join(" and ")}`, true);
  stdout.write(`✓ Stored Worker secrets ${missing.join(" and ")}\n`);
}
