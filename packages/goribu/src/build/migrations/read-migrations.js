import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const MIGRATIONS_DIRNAME = "migrations";
export const TRACKING_TABLE = "_goribu_migrations";
export const SEED_FILENAME = "seed.sql";

// A migration filename is a four-digit sequence, an underscore, and a lowercase
// hyphen-separated slug: 0001_create-feedback.sql. The exact shape is enforced so
// ordering is deterministic and a typo cannot silently reorder history.
const MIGRATION_FILENAME = /^(\d{4})_([a-z0-9]+(?:-[a-z0-9]+)*)\.sql$/;
const UP_MARKER = /^--\s*migrate:up\s*$/;
const DOWN_MARKER = /^--\s*migrate:down\s*$/;
const NO_TRANSACTION_DIRECTIVE = /^--\s*goribu:no-transaction\s*$/;
const DIRECTIVE_PREFIX = /^\s*--\s*goribu:/i;

/**
 * Read, validate, and parse the application's migration files.
 *
 * Returns migrations ordered by sequence, each carrying its up and down SQL and a
 * whole-file checksum. A missing `migrations/` directory is not an error: it means
 * no migrations exist yet. `seed.sql` is reserved and never treated as a migration.
 *
 * @param {{ migrationsDir: string }} options
 * @returns {ReadonlyArray<{ name: string, sequence: number, upSql: string, downSql: string, checksum: string, transaction: boolean }>}
 */
export function readMigrations({ migrationsDir } = {}) {
  if (typeof migrationsDir !== "string" || migrationsDir.length === 0) {
    throw new TypeError(
      "[Goribu] readMigrations({ migrationsDir }) requires the migrations directory path.",
    );
  }

  let entries;
  try {
    entries = readdirSync(migrationsDir, { withFileTypes: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return Object.freeze([]);
    throw cause;
  }

  const bySequence = new Map();
  const migrations = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".sql")) continue;
    if (entry.name === SEED_FILENAME) continue;

    const matched = MIGRATION_FILENAME.exec(entry.name);
    if (matched === null) {
      throw new Error(
        `[Goribu] Migration file ${JSON.stringify(entry.name)} does not match the required name. ` +
          "Use a four-digit sequence and a lowercase slug, for example 0001_create-feedback.sql. " +
          "Rename it (or create it with `goribu migrate:new <name>`).",
      );
    }

    const sequence = Number(matched[1]);
    const existing = bySequence.get(sequence);
    if (existing !== undefined) {
      throw new Error(
        `[Goribu] Migration sequence ${matched[1]} is used by both ${JSON.stringify(existing)} and ${JSON.stringify(entry.name)}. ` +
          "Each migration needs a unique sequence; renumber one of them so history has one order.",
      );
    }
    bySequence.set(sequence, entry.name);

    const raw = normalizeNewlines(
      readFileSync(join(migrationsDir, entry.name), "utf8"),
    );
    const { upSql, downSql, transaction } = parseSections(entry.name, raw);
    migrations.push(
      Object.freeze({
        name: entry.name.slice(0, -".sql".length),
        sequence,
        upSql,
        downSql,
        checksum: createHash("sha256").update(raw, "utf8").digest("hex"),
        transaction,
      }),
    );
  }

  migrations.sort((a, b) => a.sequence - b.sequence);
  return Object.freeze(migrations);
}

/** Split a normalized migration file into its up and down sections. */
function parseSections(filename, raw) {
  const lines = raw.split("\n");
  let upLine = -1;
  let downLine = -1;
  let transaction = true;
  for (let index = 0; index < lines.length; index += 1) {
    if (index === 0 && NO_TRANSACTION_DIRECTIVE.test(lines[index])) {
      transaction = false;
    } else if (DIRECTIVE_PREFIX.test(lines[index])) {
      throw new Error(
        `[Goribu] Migration ${JSON.stringify(filename)} has an unrecognized or misplaced Goribu directive on line ${index + 1}: ${JSON.stringify(lines[index].trim())}. ` +
          "The only directive is `-- goribu:no-transaction`, it must be the very first line of the file, and it applies to Postgres only. Move it to line 1 or remove it.",
      );
    }
    if (UP_MARKER.test(lines[index])) {
      if (upLine !== -1) throw markerError(filename, "-- migrate:up", "more than once");
      upLine = index;
    } else if (DOWN_MARKER.test(lines[index])) {
      if (downLine !== -1) throw markerError(filename, "-- migrate:down", "more than once");
      downLine = index;
    }
  }

  if (upLine === -1) throw markerError(filename, "-- migrate:up", "no");
  if (downLine === -1) throw markerError(filename, "-- migrate:down", "no");
  if (downLine < upLine) {
    throw new Error(
      `[Goribu] Migration ${JSON.stringify(filename)} places -- migrate:down before -- migrate:up. ` +
        "Order the sections up then down so forward SQL is never mistaken for rollback SQL.",
    );
  }

  return {
    upSql: lines.slice(upLine + 1, downLine).join("\n").trim(),
    downSql: lines.slice(downLine + 1).join("\n").trim(),
    transaction,
  };
}

function markerError(filename, marker, quantity) {
  return new Error(
    `[Goribu] Migration ${JSON.stringify(filename)} has ${quantity} ${JSON.stringify(marker)} marker. ` +
      "Every migration needs exactly one `-- migrate:up` line followed by exactly one `-- migrate:down` line, " +
      "so forward SQL and rollback SQL never blur together. The down section may be empty; the marker may not.",
  );
}

/** Checksums and parsing normalize CRLF to LF so line endings never change identity. */
export function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n");
}
