/**
 * A lazy, bound D1 statement.
 *
 * The tag returns a Statement that has not run. Nothing touches the database until a
 * terminal method is called, which is what lets atomic() accept statements as values
 * and what makes one vocabulary work everywhere. A statement may be executed more
 * than once.
 *
 * The SQL text and bound params are held in module-private state, not on the instance:
 * a tagged statement must not be mutable into arbitrary SQL, and its params must not be
 * replaceable after tag-time validation. The only assembled-SQL path stays unsafe().
 * The context supplies `prepare(sql, params)`, which returns a bound D1 prepared
 * statement, and may supply internal capture/record hooks for query instrumentation.
 * Request-scoped consistency modes can therefore select their own session and share
 * one recorder without exposing mutable query data.
 */
import { GoribuD1Error, wrapDatabaseError } from "./goribu-d1-error.js";

const AWAIT_WITHOUT_RUN =
  "[Goribu] This query was awaited without being run. Add a terminal " +
  "method: .run() for writes, .get() for one row, .all() for many, " +
  ".value() for a single value.";

/** Private, immutable { context, sql, params } for each statement. */
const internals = new WeakMap();

export class Statement {
  /**
   * @param {{ prepare(sql: string, params: unknown[]): object, capture?: Function, record?: Function }} context
   * @param {string} sql
   * @param {unknown[]} params
   */
  constructor(context, sql, params) {
    internals.set(this, { context, sql, params });
  }

  /**
   * Reject when a statement is awaited without a terminal method. Without this,
   * `await req.d1`DELETE ...`` would resolve to the statement object and silently do
   * nothing — a data-loss-shaped bug that looks like working code.
   */
  then(_resolve, reject) {
    reject(new GoribuD1Error(AWAIT_WITHOUT_RUN));
  }

  /** The first matching row as a plain object, or null. */
  async get() {
    const result = await execute(this, "get");
    return result?.results?.[0] ?? null;
  }

  /** Every matching row, or [] when nothing matches. */
  async all() {
    const result = await execute(this, "all");
    return result?.results ?? [];
  }

  /**
   * The first column of the first row, or null. D1's all() preserves metadata; the
   * returned row object's key order preserves the selected-column order for this
   * deliberately single-value convenience method.
   */
  async value() {
    const result = await execute(this, "value");
    const row = result?.results?.[0];
    if (row === undefined || row === null) return null;
    const firstColumn = Object.keys(row)[0];
    return firstColumn === undefined ? null : row[firstColumn];
  }

  /** Apply a write or DDL statement; returns { changes, lastRowId }. */
  async run() {
    const result = await execute(this, "run");
    return {
      changes: result?.meta?.changes,
      lastRowId: result?.meta?.last_row_id,
    };
  }
}

export function isStatement(value) {
  return value instanceof Statement;
}

/**
 * Return a statement's private query data for framework-owned rebinding. atomic() uses
 * this to deliberately ignore the statement's freshness context and prepare every query
 * through the atomic owner's binding.
 */
export function getStatementQuery(statement) {
  const { sql, params } = internals.get(statement);
  return { sql, params };
}

/** Snapshot mutable query values immediately before they are bound. */
export function captureQuery(context, sql, params) {
  if (typeof context.record !== "function") return undefined;
  if (typeof context.capture !== "function") return { sql, params };
  try {
    return context.capture({ sql, params });
  } catch {
    return { sql, params };
  }
}

/**
 * Report one successful operation without allowing instrumentation to affect it.
 * `terminal` names the public terminal method ("get" | "all" | "value" | "run"), or is
 * undefined for atomic entries; the recorder uses it for the wasteful-get() warning.
 */
export function reportQuery(context, sql, params, meta, capturedQuery, terminal) {
  if (typeof context.record !== "function") return;
  try {
    context.record({
      sql: capturedQuery?.sql ?? sql,
      params: capturedQuery?.params ?? params,
      meta,
      terminal,
    });
  } catch {
    // Query instrumentation is diagnostic and must never turn success into failure.
  }
}

async function execute(statement, terminal) {
  const { context, sql, params } = internals.get(statement);
  // get/all/value all run through metadata-bearing all(); only run() uses run().
  const method = terminal === "run" ? "run" : "all";
  const capturedQuery = captureQuery(context, sql, params);
  let result;
  try {
    result = await context.prepare(sql, params)[method]();
  } catch (cause) {
    throw wrapDatabaseError(cause);
  }

  reportQuery(context, sql, params, result?.meta, capturedQuery, terminal);
  return result;
}

