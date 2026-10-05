import { spawn as nodeSpawn } from "node:child_process";
import { getCloudflareAccess } from "./cloudflare-access.js";
import { resolveWranglerBin } from "./resolve-wrangler-bin.js";
import { forwardWranglerDiagnostics } from "./wrangler-diagnostics.js";

/**
 * Run Goribu's bundled Wrangler in the app, pinned to the account deploy uses.
 * Wrangler is a dependency of `goribu`, not of the app, so it is usually not on
 * PATH; repair messages print `pnpm exec goribu wrangler …` instead.
 */
export async function runWrangler({ projectRoot, args, spawn = nodeSpawn, resolveBin = resolveWranglerBin, getAccess = getCloudflareAccess }) {
  if (args.length === 0) {
    throw new Error("[Goribu] `goribu wrangler` needs a Wrangler command, for example `goribu wrangler r2 bucket list`.");
  }
  // A real deploy would skip Goribu's build, provisioning and migrations.
  if (args[0] === "deploy" && !args.includes("--dry-run")) {
    throw new Error("[Goribu] `goribu wrangler deploy` would skip Goribu's build, provisioning and migrations. Run `goribu deploy` instead; `goribu wrangler deploy --dry-run` is allowed for diagnostics.");
  }
  const { accountId } = await getAccess({ projectRoot, command: "goribu wrangler" });
  let wranglerBin;
  try {
    wranglerBin = resolveBin();
  } catch (cause) {
    throw new Error(
      "[Goribu] Could not find Goribu's Wrangler. Install dependencies (for example `pnpm install`), then rerun `goribu wrangler`.",
      { cause },
    );
  }

  let result;
  try {
    result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [wranglerBin, ...args], {
        cwd: projectRoot,
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId },
        stdio: ["inherit", "inherit", "pipe"],
      });
      forwardWranglerDiagnostics(child.stderr);
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal }));
    });
  } catch (cause) {
    throw new Error(
      "[Goribu] Could not run Goribu's Wrangler. Check that Node.js and the installed Wrangler executable are accessible, then rerun `goribu wrangler`.",
      { cause },
    );
  }

  if (result.signal) {
    throw new Error(`[Goribu] Wrangler was terminated by signal ${result.signal} before it finished. Check its result, then rerun the command if needed.`);
  }
  return result.code ?? 1;
}
