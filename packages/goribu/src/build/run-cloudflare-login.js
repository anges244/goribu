import { spawn as nodeSpawn } from "node:child_process";
import { resolveWranglerBin } from "./resolve-wrangler-bin.js";
import { forwardWranglerDiagnostics } from "./wrangler-diagnostics.js";

/** Let Goribu's installed Wrangler own interactive login and credential storage. */
export async function runCloudflareLogin({ projectRoot, spawn = nodeSpawn, resolveBin = resolveWranglerBin }) {
  let wranglerBin;
  try {
    wranglerBin = resolveBin();
  } catch (cause) {
    throw new Error(
      "[Goribu] Could not find Wrangler for Cloudflare login. Install dependencies (for example `pnpm install`), then rerun `goribu cloudflare-login`.",
      { cause },
    );
  }

  let result;
  try {
    result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [wranglerBin, "login"], {
        cwd: projectRoot,
        stdio: ["inherit", "inherit", "pipe"],
      });
      forwardWranglerDiagnostics(child.stderr);
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal }));
    });
  } catch (cause) {
    throw new Error(
      "[Goribu] Could not run Wrangler for Cloudflare login. Check that Node.js and the installed Wrangler executable are accessible, then rerun `goribu cloudflare-login`.",
      { cause },
    );
  }

  if (result.signal) {
    throw new Error(
      `[Goribu] Wrangler was terminated by signal ${result.signal} before login finished. Rerun \`goribu cloudflare-login\` to finish authorizing Cloudflare.`,
    );
  }
  return result.code ?? 1;
}
