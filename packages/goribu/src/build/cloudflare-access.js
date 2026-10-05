import { spawn as nodeSpawn } from "node:child_process";
import { resolve } from "node:path";
import { resolveWranglerBin } from "./resolve-wrangler-bin.js";
import { forwardWranglerDiagnostics } from "./wrangler-diagnostics.js";

/** Resolve Wrangler's current credentials without reading its private storage. */
export async function getCloudflareAccess(options) {
  const projectRoot = options?.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] getCloudflareAccess({ projectRoot }) requires the application project root.",
    );
  }
  // Repair messages tell the user to rerun the command that needed the account.
  const command = options?.command ?? "goribu deploy";
  const runJson = options?.runJson ?? runWranglerJson;
  const token = await runJson({
    projectRoot,
    command,
    args: ["auth", "token", "--json"],
    description: "read Wrangler's authenticated Cloudflare credentials",
  });
  const identity = await runJson({
    projectRoot,
    command,
    args: ["whoami", "--json"],
    description: "resolve Wrangler's Cloudflare account",
  });

  const accounts = identity?.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error(
      `[Goribu] Wrangler returned no Cloudflare accounts. Run \`pnpm exec goribu cloudflare-login\`, confirm account access, then rerun \`${command}\`.`,
    );
  }
  const requestedAccountId = Object.prototype.hasOwnProperty.call(
    options,
    "accountId",
  )
    ? options.accountId
    : process.env.CLOUDFLARE_ACCOUNT_ID;
  let account;
  if (requestedAccountId !== undefined) {
    account = accounts.find((candidate) => candidate?.id === requestedAccountId);
    if (account === undefined) {
      throw new Error(
        `[Goribu] CLOUDFLARE_ACCOUNT_ID ${JSON.stringify(requestedAccountId)} is not available to Wrangler's current credentials. ` +
          `Select an accessible account or run \`pnpm exec goribu cloudflare-login\` to log in again, then rerun \`${command}\`.`,
      );
    }
  } else if (accounts.length === 1) {
    [account] = accounts;
  } else {
    throw new Error(
      "[Goribu] Wrangler's credentials can access more than one Cloudflare account, so Goribu cannot safely choose one. " +
        `Set CLOUDFLARE_ACCOUNT_ID to the intended account and rerun \`${command}\`.`,
    );
  }
  if (typeof account?.id !== "string" || account.id.length === 0) {
    throw new Error(
      `[Goribu] Wrangler returned an invalid Cloudflare account. Update Goribu to update its Wrangler dependency, run \`pnpm exec goribu cloudflare-login\` to log in again, and rerun \`${command}\`.`,
    );
  }

  return Object.freeze({ accountId: account.id, headers: authHeaders(token, command) });
}

async function runWranglerJson(options) {
  const spawn = options?.spawn ?? nodeSpawn;
  const resolveBin = options?.resolveBin ?? resolveWranglerBin;
  let wranglerBin;
  try {
    wranglerBin = resolveBin();
  } catch (cause) {
    throw new Error(
      `[Goribu] Could not find Wrangler. Install dependencies (for example \`pnpm install\`) and rerun \`${options.command}\`.`,
      { cause },
    );
  }

  let child;
  try {
    child = spawn(process.execPath, [wranglerBin, ...options.args], {
      cwd: resolve(options.projectRoot),
      stdio: ["ignore", "pipe", "pipe"],
    });
    forwardWranglerDiagnostics(child.stderr);
  } catch (cause) {
    throw wranglerAccessError(options, cause);
  }
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += String(chunk);
  });
  const { code, signal } = await new Promise((resolvePromise, rejectPromise) => {
    child.on("error", (cause) =>
      rejectPromise(wranglerAccessError(options, cause)),
    );
    child.on("close", (exitCode, terminatingSignal) =>
      resolvePromise({ code: exitCode, signal: terminatingSignal }),
    );
  });
  if (signal !== null || code !== 0) {
    throw wranglerAccessError(options);
  }
  try {
    return JSON.parse(output);
  } catch (cause) {
    throw wranglerAccessError(options, cause);
  }
}

function wranglerAccessError({ description, command }, cause) {
  return new Error(
    `[Goribu] Could not ${description}. Read the Wrangler error above; run \`pnpm exec goribu cloudflare-login\` locally or configure CLOUDFLARE_API_TOKEN for non-interactive use, confirm account access and network connectivity, then rerun \`${command}\`.`,
    { cause },
  );
}

function authHeaders(credentials, command) {
  if (
    (credentials?.type === "api_token" || credentials?.type === "oauth") &&
    typeof credentials.token === "string" &&
    credentials.token.length > 0
  ) {
    return Object.freeze({ Authorization: `Bearer ${credentials.token}` });
  }
  if (
    credentials?.type === "api_key" &&
    typeof credentials.key === "string" &&
    credentials.key.length > 0 &&
    typeof credentials.email === "string" &&
    credentials.email.length > 0
  ) {
    return Object.freeze({
      "X-Auth-Key": credentials.key,
      "X-Auth-Email": credentials.email,
    });
  }
  throw new Error(
    `[Goribu] Wrangler returned unsupported Cloudflare credentials. Update Goribu to update its Wrangler dependency, run \`pnpm exec goribu cloudflare-login\` to log in again, and rerun \`${command}\`.`,
  );
}
