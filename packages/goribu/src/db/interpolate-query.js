/**
 * Turn a tagged-template query into `{ sql, params }`, and validate every value.
 *
 * This is the single most important property of the D1 surface: interpolated values
 * never enter the SQL text. Each value becomes one `?` (or, for a non-empty array,
 * that many `?` joined with `, `), and the value itself is collected as a bound
 * parameter. Rejections are teaching errors that name the value's position, thrown at
 * tag time so the stack points at the query rather than at execution.
 *
 * The accepted types are deliberately narrow (build spec §3):
 *   string, number, null          → one placeholder, bound as-is
 *   boolean                       → one placeholder, bound as 1 / 0
 *   ArrayBuffer, ArrayBufferView  → one placeholder, bound as-is
 *   non-empty array of the above  → N placeholders, values flattened in
 * Everything else — empty array, undefined, Date, other objects, nested arrays,
 * functions, symbols, bigints — throws.
 */
import { GoribuD1Error } from "./goribu-d1-error.js";

/**
 * @param {readonly string[]} strings the fixed template parts
 * @param {readonly unknown[]} values the interpolated values
 * @returns {{ sql: string, params: unknown[] }}
 */
export function interpolateQuery(strings, values) {
  // Require the immutable shape JavaScript creates for a tagged-template call. A normal
  // array — including one with a hand-added `raw` property — must not become an
  // unlabelled assembled-SQL path. The only string-taking path is unsafe().
  if (!isTemplateStringsObject(strings, values.length)) {
    throw new GoribuD1Error(
      "[Goribu] req.d1 must be used as a tagged template: req.d1`SELECT ...`. " +
        "Call it with a template literal, not as a normal function. To run SQL you " +
        "assembled as a string, use req.d1.unsafe(text, params).",
    );
  }

  const total = values.length;
  let sql = strings[0];
  const params = [];

  for (let index = 0; index < total; index += 1) {
    sql += bindValue(values[index], index, total, params) + strings[index + 1];
  }

  return { sql, params };
}

function isTemplateStringsObject(strings, valueCount) {
  if (!Array.isArray(strings) || !Object.isFrozen(strings)) return false;
  if (strings.length !== valueCount + 1) return false;
  if (strings.some((part) => typeof part !== "string")) return false;

  const rawDescriptor = Object.getOwnPropertyDescriptor(strings, "raw");
  if (
    rawDescriptor === undefined ||
    !("value" in rawDescriptor) ||
    rawDescriptor.enumerable ||
    rawDescriptor.configurable ||
    rawDescriptor.writable
  ) {
    return false;
  }

  const raw = rawDescriptor.value;
  return (
    Array.isArray(raw) &&
    Object.isFrozen(raw) &&
    raw.length === strings.length &&
    raw.every((part) => typeof part === "string")
  );
}

/**
 * Validate an explicit `unsafe(text, params)` parameter list. Same value rules as
 * interpolation, minus array expansion: an array here is an error, because the
 * placeholder count in the literal text is the caller's responsibility.
 *
 * @param {readonly unknown[]} params
 * @returns {unknown[]}
 */
export function validateUnsafeParams(params) {
  const total = params.length;
  const validated = [];
  for (let index = 0; index < total; index += 1) {
    const value = params[index];
    if (Array.isArray(value)) {
      throw new GoribuD1Error(
        `[Goribu] Cannot pass an array as unsafe() parameter ${index + 1} of ${total}. ` +
          "unsafe() does not expand arrays; write one placeholder per value and pass one value each.",
      );
    }
    validated.push(coerceScalar(value, index, total));
  }
  return validated;
}

function bindValue(value, index, total, params) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new GoribuD1Error(
        `[Goribu] Cannot interpolate an empty array into a query (value ${index + 1} of ${total}).\n` +
          "`IN ()` is not valid SQL and Goribu will not guess whether you meant\n" +
          '"match nothing" or "match everything". Check the array before querying.',
      );
    }

    const placeholders = new Array(value.length);
    for (let element = 0; element < value.length; element += 1) {
      params.push(coerceScalar(value[element], index, total));
      placeholders[element] = "?";
    }
    return placeholders.join(", ");
  }

  params.push(coerceScalar(value, index, total));
  return "?";
}

/** Validate one scalar value and return the form bound to the database. */
function coerceScalar(value, index, total) {
  if (value === null) return null;

  const type = typeof value;
  if (type === "string" || type === "number") return value;
  if (type === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;

  throw rejection(value, type, index, total);
}

function rejection(value, type, index, total) {
  const position = `(value ${index + 1} of ${total})`;

  if (value === undefined) {
    return new GoribuD1Error(
      `[Goribu] Cannot interpolate undefined into a query ${position}.\n` +
        "Use null for a SQL NULL.",
    );
  }
  if (value instanceof Date) {
    return new GoribuD1Error(
      `[Goribu] Cannot interpolate a Date into a query ${position}.\n` +
        "SQLite has no date type. Pass date.toISOString() and store it as TEXT.",
    );
  }
  if (type === "bigint") {
    return new GoribuD1Error(
      `[Goribu] Cannot interpolate a bigint into a query ${position}.\n` +
        "SQLite stores 64-bit integers; pass a number, or a string for values beyond Number.MAX_SAFE_INTEGER.",
    );
  }
  if (type === "function") {
    return new GoribuD1Error(
      `[Goribu] Cannot interpolate a function into a query ${position}.\n` +
        "Pass a value, not a function.",
    );
  }
  if (type === "symbol") {
    return new GoribuD1Error(
      `[Goribu] Cannot interpolate a symbol into a query ${position}.\n` +
        "Pass a string, number, boolean, null, or binary value.",
    );
  }

  // Any other object, including a nested array interpolated inside another array.
  return new GoribuD1Error(
    `[Goribu] Cannot interpolate an object into a query ${position}.\n` +
      "Pass JSON.stringify(value) if the column stores JSON.",
  );
}

