import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MIGRATIONS_DIRNAME, readMigrations } from "./read-migrations.js";

/**
 * Scaffold the next migration file with the required section markers.
 *
 * The sequence is one past the highest existing migration, zero-padded to four digits.
 * The up and down sections are created empty so "no down section" stays unambiguous:
 * the markers are always present, the SQL between them is the author's to write.
 *
 * @param {{ projectRoot: string, name: string, stdout?: { write(text: string): void } }} options
 * @returns {{ file: string, name: string }}
 */
export function runMigrateNew(options) {
  const projectRoot = options?.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] runMigrateNew({ projectRoot }) requires the application project root.",
    );
  }
  const stdout = options?.stdout ?? process.stdout;
  const slug = slugify(options?.name);
  if (slug === null) {
    throw new Error(
      "[Goribu] `goribu migrate:new <name>` requires a descriptive name, for example " +
        "`goribu migrate:new create feedback`. Use letters and digits.",
    );
  }

  const migrationsDir = resolve(projectRoot, MIGRATIONS_DIRNAME);
  mkdirSync(migrationsDir, { recursive: true });
  const existing = readMigrations({ migrationsDir });
  const nextSequence = (existing.at(-1)?.sequence ?? 0) + 1;
  if (nextSequence > 9999) {
    throw new Error(
      "[Goribu] The migration sequence has reached its four-digit limit. This is not expected; reach out before renumbering history.",
    );
  }

  const name = `${String(nextSequence).padStart(4, "0")}_${slug}`;
  const file = join(migrationsDir, `${name}.sql`);
  if (existsSync(file)) {
    throw new Error(
      `[Goribu] ${name}.sql already exists. Choose a different name or remove the existing file.`,
    );
  }

  writeFileSync(file, template(slug), "utf8");
  stdout.write(`✓ Created ${join(MIGRATIONS_DIRNAME, `${name}.sql`)}\n`);
  return { file, name };
}

function template(slug) {
  return (
    `-- ${slug}\n` +
    "-- Migrations are forward-only; undo a change with a new migration.\n\n"
  );
}

/** Lowercase, collapse non-alphanumeric runs to single hyphens, and trim them. */
function slugify(name) {
  if (typeof name !== "string") return null;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length === 0 ? null : slug;
}
