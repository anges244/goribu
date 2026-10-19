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
 * Returns migrations ordered by sequence, each carrying its forward SQL and a
 * whole-file checksum. A missing `migrations/` directory is not an error: it means
 * no migrations exist yet. `seed.sql` is reserved and never treated as a migration.
 *
 * @param {{ migrationsDir: string }} options
 * @returns {ReadonlyArray<{ name: string, sequence: number, upSql: string, checksum: string, transaction: boolean }>}
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
    const { upSql, transaction } = parseSections(entry.name, raw);
    migrations.push(
      Object.freeze({
        name: entry.name.slice(0, -".sql".length),
        sequence,
        upSql,
        checksum: createHash("sha256").update(raw, "utf8").digest("hex"),
        transaction,
      }),
    );
  }

  migrations.sort((a, b) => a.sequence - b.sequence);
  return Object.freeze(migrations);
}

/** Read plain SQL or the forward section of a legacy marked file. */
function parseSections(filename, raw) {
  const lines = raw.split("\n");
  const upLines = [];
  const downLines = [];
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
      upLines.push(index);
    } else if (DOWN_MARKER.test(lines[index])) {
      downLines.push(index);
    }
  }

  if (upLines.length === 0 && downLines.length > 0) {
    throw new Error(
      `[Goribu] Migration ${JSON.stringify(filename)} has a down section without an up marker. ` +
        "Delete the down section, including its marker. Migrations are forward-only; undo a change with a new migration.",
    );
  }
  if (upLines.length > 1) throw markerError(filename, "up");
  if (downLines.length > 1) throw markerError(filename, "down");
  const [upLine] = upLines;
  const [downLine] = downLines;
  if (downLine !== undefined && downLine < upLine) {
    throw new Error(
      `[Goribu] Migration ${JSON.stringify(filename)} places the down marker before the up marker. ` +
        "Order the legacy sections up then down so rollback SQL cannot run as forward SQL.",
    );
  }

  return {
    upSql: upLine === undefined ? raw.trim() : lines.slice(upLine + 1, downLine).join("\n").trim(),
    transaction,
  };
}

function markerError(filename, marker) {
  return new Error(
    `[Goribu] Migration ${JSON.stringify(filename)} has more than one ${marker} marker. ` +
      "A legacy migration must have exactly one up marker and at most one down marker, in that order. Remove the duplicate marker.",
  );
}

/** Checksums and parsing normalize CRLF to LF so line endings never change identity. */
export function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n");
}
