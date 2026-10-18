import { lstatSync } from "node:fs";
import { join } from "node:path";

const PRODUCTION_SECRETS_FILE = ".env.production";

/** Choose the deploy input without parsing it or falling back to local secrets. */
export function findProductionSecretsFile(projectRoot) {
  try {
    // lstat keeps a dangling symlink in the plan: Wrangler must reject it rather
    // than silently deploying with the previous secrets.
    lstatSync(join(projectRoot, PRODUCTION_SECRETS_FILE));
    return PRODUCTION_SECRETS_FILE;
  } catch (cause) {
    if (cause.code === "ENOENT") return undefined;
    throw new Error(
      "[Goribu] Could not inspect .env.production. Make the file and its directory readable, then retry the command.",
      { cause },
    );
  }
}

export function formatSecretsPlan(secretsFile, { postgres = false } = {}) {
  if (postgres) {
    return secretsFile
      ? "Secrets: upload remaining entries from .env.production; POSTGRES_URL and POSTGRES_MIGRATE_URL are excluded; preserve other existing secrets."
      : "Secrets: use existing platform secrets; POSTGRES_URL and POSTGRES_MIGRATE_URL are excluded from upload.";
  }
  return secretsFile
    ? "Secrets: upload from .env.production; preserve other existing secrets."
    : "Secrets: use existing platform secrets; no .env.production found.";
}
