import { spawn as nodeSpawn } from "node:child_process";
import { forwardWranglerDiagnostics } from "./wrangler-diagnostics.js";
import { assertNoDuplicateD1Declaration } from "./assert-no-duplicate-d1.js";
import { finalizeD1Binding } from "./finalize-d1-binding.js";
import { loadApplicationConfig } from "./load-application-config.js";
import { runMigrate } from "./migrations/run-migrate.js";
import { provisionD1 } from "./provision-d1.js";
import { resolveWranglerBin } from "./resolve-wrangler-bin.js";
import { assertNoDuplicateKVDeclaration } from "./assert-no-duplicate-kv.js";
import { assertNoDuplicateR2Declaration } from "./assert-no-duplicate-r2.js";
import { provisionKV } from "./provision-kv.js";
import { provisionR2 } from "./provision-r2.js";
import { ensureR2SigningSecret } from "./r2-secrets.js";
import { finalizeKVBinding } from "./finalize-kv-binding.js";
import { finalizeR2Account } from "./finalize-r2-account.js";
import { getCloudflareAccess } from "./cloudflare-access.js";
import { findProductionSecretsFile, formatSecretsPlan } from "./production-secrets.js";

export { resolveWranglerBin } from "./resolve-wrangler-bin.js";

/** Validate, authenticate, build, provision, attach bindings, migrate, and deploy. */
export async function runDeploy(options) {
  const projectRoot = options?.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] runDeploy({ projectRoot, build }) requires the application project root.",
    );
  }
  const build = options?.build;
  if (typeof build !== "function") {
    throw new TypeError(
      "[Goribu] runDeploy({ build }) requires the production build callback.",
    );
  }

  const loadConfig = options?.loadConfig ?? loadApplicationConfig;
  const guard = options?.guard ?? assertNoDuplicateD1Declaration;
  const provision = options?.provision ?? provisionD1;
  const migrate = options?.migrate ?? runMigrate;
  const finalize = options?.finalize ?? finalizeD1Binding;
  const deploy = options?.deploy ?? runWranglerDeploy;
  const appConfig = await loadConfig({ projectRoot });

  // Prove all local inputs and the complete production build before the first
  // remote mutation. The Vite plugin repeats the ownership guard so standalone
  // `goribu build` has the same protection.
  await guard({ projectRoot, appConfig });
  await (options?.guardKV ?? assertNoDuplicateKVDeclaration)({ projectRoot, appConfig });
  await (options?.guardR2 ?? assertNoDuplicateR2Declaration)({ projectRoot, appConfig });
  const secretsFile = findProductionSecretsFile(projectRoot);
  (options?.stdout ?? process.stdout).write(`${formatSecretsPlan(secretsFile)}\n`);
  // Authentication is read-only remote work, not provisioning. Fail before an
  // expensive build even when the application declares no managed resources.
  const access = await (options?.getAccess ?? getCloudflareAccess)({ projectRoot });
  const getAccess = async () => access;
  await build();

  // This is public build configuration, never a secret. Finalize it before
  // Wrangler validates the artifact and before any production resources change.
  if (appConfig.r2 !== undefined) {
    (options?.finalizeR2Account ?? finalizeR2Account)({ projectRoot, appConfig, accountId: access.accountId });
  }

  if (secretsFile) {
    await (options?.validateSecrets ?? validateProductionSecrets)({ projectRoot, secretsFile, accountId: access.accountId });
  }

  // Inspect both R2 buckets and reject unsafe public access before D1/KV writes
  // or migrations. R2 itself only creates buckets after its full inspection.
  await (options?.provisionR2 ?? provisionR2)({
    projectRoot,
    appConfig,
    getAccess,
    stdout: options?.stdout ?? process.stdout,
  });

  const database = await provision({
    projectRoot,
    appConfig,
    getAccess,
    stdout: options?.stdout ?? process.stdout,
  });

  const namespace = await (options?.provisionKV ?? provisionKV)({
    projectRoot,
    appConfig,
    getAccess,
    stdout: options?.stdout ?? process.stdout,
  });

  if (namespace !== null) {
    (options?.finalizeKV ?? finalizeKVBinding)({ projectRoot, appConfig, namespace });
  }

  if (database !== null) {
    // Finish the local deploy artifact as soon as provisioning provides the UUID. A malformed
    // artifact should stop here, before pending SQL changes production schema.
    finalize({ projectRoot, appConfig, database });

    // Production schema is ready before the new Worker becomes reachable. Reusing the
    // loaded config keeps deploy on one view of the application, while runMigrate's
    // drift guard ensures a changed or missing applied file blocks the upload.
    await migrate({
      projectRoot,
      target: "remote",
      loadConfig: async () => appConfig,
      errorLabel: "goribu deploy",
      stdout: options?.stdout ?? process.stdout,
    });
  }
  // On first deploy Wrangler may create a draft Worker to hold the secret.
  // Finish provisioning and migrations before that first Worker mutation.
  if (appConfig.r2 !== undefined) {
    await (options?.ensureR2SigningSecret ?? ensureR2SigningSecret)({ projectRoot, appConfig, access, stdout: options?.stdout ?? process.stdout });
  }
  return deploy({ projectRoot, secretsFile, accountId: access.accountId });
}

/** Let pinned Wrangler validate the file and built Worker before remote mutation. */
export async function validateProductionSecrets(options) {
  const code = await runWranglerDeploy({ ...options, dryRun: true });
  if (code !== 0) {
    throw new Error(
      `[Goribu] Wrangler could not validate .env.production and the built Worker (exit code ${code}). ` +
        "Ensure .env.production is readable and contains valid KEY=value entries or a JSON object of string values. " +
        "To see Wrangler's diagnostic, run `pnpm --dir node_modules/goribu exec wrangler deploy --cwd \"$PWD\" --dry-run --secrets-file=.env.production` from the app directory " +
        "(its output may include text from the file). Fix the reported problem, then retry `goribu deploy`. No resources or migrations were changed.",
    );
  }
}

/**
 * Launch `wrangler deploy` for the built application.
 *
 * The production build has already written the deploy-redirect that points
 * Wrangler at the generated Worker bundle and static assets; this only runs
 * Wrangler and reports how it finished. `spawn` and `resolveBin` are injectable
 * so the launching contract can be tested without a network or a real deploy.
 *
 * @param {{ projectRoot: string, accountId?: string, secretsFile?: string, dryRun?: boolean, spawn?: Function, resolveBin?: Function }} options
 * @returns {Promise<number>} Wrangler's exit code (0 on success)
 */
export async function runWranglerDeploy(options) {
  const projectRoot = options?.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] runWranglerDeploy({ projectRoot }) requires the application project root.",
    );
  }

  const spawn = options?.spawn ?? nodeSpawn;
  const resolveBin = options?.resolveBin ?? resolveWranglerBin;

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
    const args = [wranglerBin, "deploy"];
    if (options.dryRun) args.push("--dry-run");
    if (options.secretsFile) args.push(`--secrets-file=${options.secretsFile}`);
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      // The parent selected this account before provisioning. An explicit child
      // env value also wins over Wrangler's project .env loading, in both modes.
      ...(options.accountId === undefined ? {} : {
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: options.accountId },
      }),
      // Parser diagnostics can include source text. The preflight reports a
      // teaching error itself so malformed secrets cannot reach terminal logs.
      stdio: options.dryRun ? "ignore" : ["inherit", "inherit", "pipe"],
    });
    forwardWranglerDiagnostics(child.stderr);
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
        "The deploy did not complete; re-run `goribu deploy`.",
    );
  }

  return code ?? 1;
}
