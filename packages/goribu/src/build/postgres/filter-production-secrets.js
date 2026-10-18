import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseProductionSecrets } from "./read-postgres-env.js";

/** Return Wrangler's secrets input and a cleanup to call in the deploy's finally. */
export function filterProductionSecrets({ projectRoot, secretsFile } = {}) {
  if (typeof projectRoot !== "string" || !projectRoot ||
      (secretsFile !== undefined && (typeof secretsFile !== "string" || !secretsFile))) {
    throw new TypeError("[Goribu] filterProductionSecrets requires projectRoot and a secretsFile path, or undefined when no production secrets file exists.");
  }
  if (secretsFile === undefined) return { secretsFile: undefined, cleanup() {} };

  let entries;
  try {
    entries = parseProductionSecrets(readFileSync(resolve(projectRoot, secretsFile), "utf8"));
  } catch {
    // File/parser errors can contain source contents. Never retain them as causes.
    throw new Error("[Goribu] Could not read .env.production for secrets filtering. Make the file and its directory readable, then rerun `goribu deploy`.");
  }
  if (!Object.hasOwn(entries, "POSTGRES_URL") && !Object.hasOwn(entries, "POSTGRES_MIGRATE_URL")) {
    return { secretsFile, cleanup() {} };
  }
  const remaining = { ...entries };
  delete remaining.POSTGRES_URL;
  delete remaining.POSTGRES_MIGRATE_URL;
  if (Object.keys(remaining).length === 0) return { secretsFile: undefined, cleanup() {} };

  let directory;
  function cleanup() {
    if (directory === undefined) return;
    try {
      rmSync(directory, { recursive: true, force: true });
      directory = undefined;
    } catch {
      throw new Error("[Goribu] Could not remove the temporary production secrets directory. Check permissions in the system temporary directory and remove leftover goribu-postgres-secrets-* directories before retrying `goribu deploy`.");
    }
  }
  try {
    directory = mkdtempSync(join(tmpdir(), "goribu-postgres-secrets-"));
    const filteredFile = join(directory, "secrets.json");
    writeFileSync(filteredFile, `${JSON.stringify(remaining)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return { secretsFile: filteredFile, cleanup };
  } catch {
    cleanup();
    throw new Error("[Goribu] Could not write the filtered production secrets file. Check free space and permissions in the system temporary directory, then rerun `goribu deploy`.");
  }
}
