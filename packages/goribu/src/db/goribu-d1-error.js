/**
 * Goribu's two D1 error kinds.
 *
 * GoribuD1Error is for framework-usage mistakes the query surface can catch before
 * or instead of touching the database: interpolating an unsupported value, awaiting
 * a statement without running it, or passing the wrong thing to atomic(). Its stack
 * points at the caller's query, so these throw at tag time, not execution time.
 *
 * GoribuDatabaseError wraps a genuine failure thrown by D1 (most usefully a constraint
 * violation) into structured fields an application can answer a form with, while
 * preserving the original message and error untouched. Neither class is exported from
 * a public entry: applications duck-type the documented properties in a catch block.
 */

export class GoribuD1Error extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "GoribuD1Error";
  }
}

export class GoribuDatabaseError extends Error {
  /**
   * @param {string} message the original D1 message, unmodified
   * @param {{
   *   cause: unknown,
   *   constraint?: "unique"|"notNull"|"foreignKey"|"check",
   *   table?: string,
   *   columns?: string[],
   *   constraintName?: string,
   * }} details
   */
  constructor(message, details) {
    super(message, { cause: details.cause });
    this.name = "GoribuDatabaseError";
    this.constraint = details.constraint;
    this.table = details.table;
    this.columns = details.columns;
    this.constraintName = details.constraintName;
  }
}

/**
 * Wrap a failure thrown by a D1 terminal method or batch in a GoribuDatabaseError.
 *
 * Parsing is best-effort and never throws: an unrecognized message produces an
 * unannotated error carrying only the original message and cause, never a guessed
 * column and never a second error.
 *
 * @param {unknown} cause
 * @returns {GoribuD1Error|GoribuDatabaseError}
 */
export function wrapDatabaseError(cause) {
  // Framework usage failures can surface lazily from a binding-shaped stub.
  // Preserve their identity instead of relabelling them as database failures.
  if (cause instanceof GoribuD1Error) return cause;

  const message = readMessage(cause);

  let fields;
  try {
    fields = parseConstraint(message);
  } catch {
    // A parser failure must degrade to an unannotated error, not a new throw.
    fields = {};
  }

  return new GoribuDatabaseError(message, { cause, ...fields });
}

/**
 * Read the original D1 message without ever throwing. A hostile cause — a throwing
 * `message` getter, a null-prototype object with no `toString`, an unstringifiable
 * value — must not replace the original failure with a new exception.
 */
function readMessage(cause) {
  try {
    if (cause !== null && typeof cause === "object") {
      const message = cause.message;
      if (typeof message === "string") return message;
    }
  } catch {
    // Fall through to coercion, then to the stable fallback.
  }
  try {
    return String(cause);
  } catch {
    return "A database error occurred, but its message could not be read.";
  }
}

/**
 * Search (not anchor) the message for SQLite's constraint patterns. D1 wraps SQLite
 * messages with its own prefix and suffix, and that wrapping has changed before, so
 * every pattern is matched anywhere in the string.
 *
 * The real message strings are verified against a live D1 (build spec §13); until
 * then these follow the documented SQLite formats.
 */
function parseConstraint(message) {
  if (/FOREIGN KEY constraint failed/.test(message)) {
    return { constraint: "foreignKey" };
  }

  let match = message.match(/UNIQUE constraint failed:([^\n]*)/);
  if (match) {
    return { constraint: "unique", ...extractColumns(match[1]) };
  }

  match = message.match(/NOT NULL constraint failed:([^\n]*)/);
  if (match) {
    return { constraint: "notNull", ...extractColumns(match[1]) };
  }

  // Stop at the next colon so D1's ": SQLITE_CONSTRAINT" suffix is not absorbed into
  // the constraint name. SQLite constraint identifiers do not contain colons.
  match = message.match(/CHECK constraint failed:\s*([^:\n)]+)/);
  if (match) {
    return { constraint: "check", constraintName: match[1].trim() };
  }

  return {};
}

/**
 * Pull the `table.column` pairs out of a UNIQUE / NOT NULL clause. A composite
 * constraint repeats the table per column; dedupe the table and keep every column.
 * If the tables somehow differ, drop the table and keep all columns.
 */
function extractColumns(clause) {
  const pairs = [
    ...clause.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g),
  ];
  if (pairs.length === 0) {
    return { table: undefined, columns: undefined };
  }

  const tables = new Set(pairs.map((pair) => pair[1]));
  const columns = pairs.map((pair) => pair[2]);
  return {
    table: tables.size === 1 ? [...tables][0] : undefined,
    columns,
  };
}
