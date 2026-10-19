/**
 * Compare migration files with the tracking ledger and classify each migration.
 *
 * Pure: given the parsed migrations and the applied ledger rows, it returns what
 * is applied, what is pending, and every drift that makes the history untrustworthy.
 * A mutating command refuses to run while any drift exists, because applying new SQL
 * on top of a changed past is how a schema silently diverges between environments.
 *
 * Drift reasons:
 *   - "modified":     an applied migration's file no longer matches its recorded checksum.
 *   - "missing":      an applied migration's file has been deleted.
 *   - "out-of-order": a pending migration is sequenced before an already-applied one.
 *
 * @param {{
 *   migrations: ReadonlyArray<{ name: string, sequence: number, checksum: string }>,
 *   appliedRows: ReadonlyArray<{ name: string, checksum: string }>,
 * }} options
 * @returns {{ applied: ReadonlyArray<object>, pending: ReadonlyArray<object>, drift: ReadonlyArray<{ name: string, reason: string }> }}
 */
export function planMigrations({ migrations, appliedRows } = {}) {
  if (!Array.isArray(migrations) || !Array.isArray(appliedRows)) {
    throw new TypeError(
      "[Goribu] planMigrations({ migrations, appliedRows }) requires both as arrays.",
    );
  }

  const fileByName = new Map(migrations.map((migration) => [migration.name, migration]));
  const appliedByName = new Map(appliedRows.map((row) => [row.name, row]));
  const drift = [];

  // A recorded migration whose file is gone or changed makes every later decision unsafe.
  for (const row of appliedRows) {
    const file = fileByName.get(row.name);
    if (file === undefined) {
      drift.push({ name: row.name, reason: "missing" });
    } else if (file.checksum !== row.checksum) {
      drift.push({ name: row.name, reason: "modified" });
    }
  }

  const applied = migrations.filter((migration) => appliedByName.has(migration.name));
  const pending = migrations.filter((migration) => !appliedByName.has(migration.name));

  // A new migration numbered below an applied one would run out of order on a
  // second environment; that is drift even though nothing was modified.
  const highestApplied = applied.reduce(
    (highest, migration) => Math.max(highest, migration.sequence),
    -1,
  );
  for (const migration of pending) {
    if (migration.sequence < highestApplied) {
      drift.push({ name: migration.name, reason: "out-of-order" });
    }
  }

  return Object.freeze({
    applied: Object.freeze(applied),
    pending: Object.freeze(pending),
    drift: Object.freeze(drift.map((entry) => Object.freeze(entry))),
  });
}

/** Render drift as one teaching error the mutating commands can throw. */
export function describeDrift(drift) {
  const lines = drift.map(({ name, reason }) => {
    if (reason === "modified") {
      return `  - ${name}: the file changed after it was applied`;
    }
    if (reason === "missing") {
      return `  - ${name}: the applied file has been deleted`;
    }
    return `  - ${name}: is sequenced before an already-applied migration`;
  });
  return (
    "[Goribu] Migration history has drifted from what was applied, so Goribu will not " +
    "run migrations until it is resolved:\n" +
    `${lines.join("\n")}\n` +
    "Restore the original files (recover them from version control), or create a new " +
    "forward migration for the change. Never edit a migration that has already run."
  );
}

// An empty scaffold must never be recorded as applied, because filling it in
// afterwards would drift its checksum.
export function assertNoEmptyMigrations(migrations) {
  const empty = migrations.find((migration) => !hasSql(migration.upSql));
  if (empty !== undefined) {
    throw new Error(
      `[Goribu] Migration ${empty.name} has no forward SQL. ` +
        "Add its forward SQL before migrating, or delete the file. Applying an empty scaffold " +
        "now and writing its SQL later would drift the recorded checksum.",
    );
  }
}

// Skip only leading whitespace and comments. Stop at the first SQL token, so
// comment-like text inside SQL strings is never stripped or interpreted here.
function hasSql(sql) {
  let index = 0;
  while (index < sql.length) {
    if (/\s/.test(sql[index])) {
      index += 1;
    } else if (sql.startsWith("--", index)) {
      const end = sql.indexOf("\n", index + 2);
      index = end === -1 ? sql.length : end + 1;
    } else if (sql.startsWith("/*", index)) {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql.startsWith("/*", index)) { depth += 1; index += 2; }
        else if (sql.startsWith("*/", index)) { depth -= 1; index += 2; }
        else index += 1;
      }
    } else {
      return true;
    }
  }
  return false;
}

export function formatMigrationStatus(target, plan) {
  const lines = [
    `Goribu migrations — ${target}`,
    "",
    `Applied (${plan.applied.length}):`,
    ...listOrNone(plan.applied.map((migration) => migration.name)),
    "",
    `Pending (${plan.pending.length}):`,
    ...listOrNone(plan.pending.map((migration) => migration.name)),
  ];
  if (plan.drift.length > 0) {
    lines.push("", `Drift (${plan.drift.length}):`);
    for (const { name, reason } of plan.drift) {
      lines.push(`  - ${name}: ${reason}`);
    }
    lines.push(
      "",
      "Resolve drift before running migrations: restore the original files or add a new forward migration.",
    );
  }
  return `${lines.join("\n")}\n`;
}

function listOrNone(names) {
  return names.length === 0 ? ["  none"] : names.map((name) => `  - ${name}`);
}
