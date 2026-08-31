import { spawn as nodeSpawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);

/**
 * Resolve the Wrangler CLI entry from Goribu's own dependency, so deployment
 * uses the pinned Wrangler rather than whatever might be on the global PATH.
 */
export function resolveWranglerBin() {
  const manifestPath = require.resolve("wrangler/package.json");
  const { bin } = JSON.parse(readFileSync(manifestPath, "utf8"));
  return resolve(dirname(manifestPath), bin.wrangler);
}

/**
 * Launch Wrangler for the built application.
 *
 * The production build has already written the deploy-redirect that points
 * Wrangler at the generated Worker bundle and static assets; this only runs
 * Wrangler and reports how it finished. With `preview`, it runs
 * `wrangler versions upload`, which uploads a new version and prints a public
 * preview URL without changing what production serves; otherwise it runs
 * `wrangler deploy`. `spawn` and `resolveBin` are injectable so the launching
 * contract can be tested without a network or a real deploy.
 *
 * @param {{ projectRoot: string, preview?: boolean, spawn?: Function, resolveBin?: Function }} options
 * @returns {Promise<number>} Wrangler's exit code (0 on success)
 */
export async function runWranglerDeploy(options) {
  const projectRoot = options?.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] runWranglerDeploy({ projectRoot }) requires the application project root.",
    );
  }

  const preview = options?.preview === true;
  const spawn = options?.spawn ?? nodeSpawn;
  const resolveBin = options?.resolveBin ?? resolveWranglerBin;

  const wranglerArgs = preview ? ["versions", "upload"] : ["deploy"];
  const invocation = preview ? "goribu deploy --preview" : "goribu deploy";

  let wranglerBin;
  try {
    wranglerBin = resolveBin();
  } catch (cause) {
    throw new Error(
      "[Goribu] Could not find Wrangler, which `goribu deploy` uses to upload to Cloudflare. " +
        "Install dependencies (for example `pnpm install`) and try again.",
      { cause },
    );
  }

  const { code, signal } = await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [wranglerBin, ...wranglerArgs], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    child.on("error", rejectPromise);
    child.on("close", (exitCode, terminatingSignal) =>
      resolvePromise({ code: exitCode, signal: terminatingSignal }),
    );
  });

  // A process killed by a signal reports code === null; never read that as
  // success. Any missing exit code is a failed deploy, not a clean one.
  if (signal) {
    throw new Error(
      `[Goribu] Wrangler was terminated by signal ${signal} before it finished. ` +
        `The deploy did not complete; re-run \`${invocation}\`.`,
    );
  }

  return code ?? 1;
}
