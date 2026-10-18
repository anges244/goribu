import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";
import { parsePostgresUrl } from "./parse-postgres-url.js";

/** Read only Postgres connection URLs, without expansion or process.env fallback. */
export function readPostgresEnv({ projectRoot, target } = {}) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0 ||
      (target !== "local" && target !== "production")) {
    throw new TypeError(
      '[Goribu] readPostgresEnv requires projectRoot and target: "local" or "production".',
    );
  }

  let entries;
  let missingInstruction;
  if (target === "production") {
    entries = readPostgresFile(projectRoot, ".env.production");
    if (entries === undefined) {
      throw new Error(
        "[Goribu] .env.production does not exist. Create .env.production and add POSTGRES_URL with your provider's direct (non-pooled) connection string.",
      );
    }
    missingInstruction = "POSTGRES_URL is missing from .env.production. Add your provider's direct (non-pooled) connection string.";
  } else {
    entries = readPostgresFile(projectRoot, ".dev.vars");
    if (entries !== undefined) {
      missingInstruction = "POSTGRES_URL is missing from .dev.vars. Goribu reads .env and .env.local only when .dev.vars does not exist; add it to .dev.vars or remove that file.";
    } else {
      entries = {
        ...readPostgresFile(projectRoot, ".env"),
        ...readPostgresFile(projectRoot, ".env.local"),
      };
      missingInstruction = "POSTGRES_URL is missing from .env and .env.local. Add it to .env (create that file if needed), or set it in .env.local to override .env. Goribu reads these files only when .dev.vars does not exist.";
    }
  }

  if (entries.POSTGRES_URL === undefined) {
    throw new Error(`[Goribu] ${missingInstruction}`);
  }
  return Object.freeze({
    url: validateEntry(entries.POSTGRES_URL),
    migrateUrl: entries.POSTGRES_MIGRATE_URL === undefined
      ? undefined
      : validateEntry(entries.POSTGRES_MIGRATE_URL),
  });
}

function readPostgresFile(projectRoot, filename) {
  let exists = false;
  let contents;
  try {
    // A dangling symlink exists: fail the read rather than falling back.
    lstatSync(join(projectRoot, filename));
    exists = true;
    contents = readFileSync(join(projectRoot, filename), "utf8");
  } catch (cause) {
    if (!exists && cause.code === "ENOENT") return undefined;
    throw new Error(
      `[Goribu] Could not read ${filename}. Make the file and its directory readable, then retry the command.`,
      { cause },
    );
  }

  let parsed;
  if (filename === ".env.production") {
    try {
      const json = JSON.parse(contents);
      if (json !== null && Object.getPrototypeOf(json) === Object.prototype) parsed = json;
    } catch {
      // Like Wrangler's --secrets-file, try dotenv after JSON parsing fails.
    }
  }
  parsed ??= parse(contents);
  const entries = {};
  for (const key of ["POSTGRES_URL", "POSTGRES_MIGRATE_URL"]) {
    if (Object.hasOwn(parsed, key)) {
      entries[key] = Object.freeze({ value: parsed[key], source: `${key} in ${filename}` });
    }
  }
  return entries;
}

function validateEntry(entry) {
  if (typeof entry.value !== "string") {
    throw new TypeError(
      `[Goribu] ${entry.source} must be a string. Set it to a PostgreSQL connection URL such as postgres://user:password@host:5432/database.`,
    );
  }
  parsePostgresUrl(entry.value, entry.source);
  return entry;
}
