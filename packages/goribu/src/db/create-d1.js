/**
 * Build the request-facing `req.d1` query surface over a Cloudflare D1 binding.
 *
 * `req.d1` is a tagged template that returns a lazy Statement, with `unsafe`,
 * `atomic`, `fresh`, `public`, `session`, and `binding` attached. The request controller
 * supplies the request-scoped binding resolver plus consistency-specific execution and
 * session accessors. Query construction never resolves the binding; terminal execution,
 * explicit binding/session access, and a valid atomic operation do.
 */
import { interpolateQuery, validateUnsafeParams } from "./interpolate-query.js";
import { GoribuD1Error, wrapDatabaseError } from "./goribu-d1-error.js";
import {
  captureQuery,
  getStatementQuery,
  Statement,
  isStatement,
  reportQuery,
} from "./statement.js";

/**
 * @param {() => object} resolveBinding lazy request-scoped D1 binding resolver
 * @param {{ prepare(sql: string, params: unknown[]): object, batch(statements: object[]): Promise<object[]>, capture?: Function, record?: Function }} [execution]
 *   default-mode execution context; defaults to the raw binding
 * @param {{
 *   getSession?: () => object,
 *   fresh?: { execution: { prepare(sql: string, params: unknown[]): object }, getSession: () => object },
 *   public?: { execution: { prepare(sql: string, params: unknown[]): object }, getSession: () => object },
 * }} [modes] internal consistency-mode contexts
 * @returns {Function & { unsafe: Function, atomic: Function, fresh: Function, public: Function, session: object, binding: unknown }}
 */
export function createD1(resolveBinding, execution, modes) {
  const context = execution ?? createBindingExecution(resolveBinding);
  const rawMode = {
    execution: context,
    getSession: resolveBinding,
  };
  const defaultMode = {
    execution: context,
    getSession: modes?.getSession ?? rawMode.getSession,
  };
  const freshMode = modes?.fresh ?? rawMode;
  const publicMode = modes?.public ?? rawMode;

  const d1 = createQueryFacade(resolveBinding, defaultMode, { atomic: true });
  const fresh = createQueryFacade(resolveBinding, freshMode, { mode: "fresh" });
  const publicD1 = createQueryFacade(resolveBinding, publicMode, { mode: "public" });

  Object.defineProperties(d1, {
    fresh: {
      enumerable: true,
      get: () => fresh,
    },
    public: {
      enumerable: true,
      get: () => publicD1,
    },
  });

  return d1;
}

function createQueryFacade(
  resolveBinding,
  { execution, getSession },
  { atomic = false, mode } = {},
) {
  const d1 = (strings, ...values) => {
    const { sql, params } = interpolateQuery(strings, values);
    return new Statement(execution, sql, params);
  };

  d1.unsafe = (text, params = []) => {
    if (typeof text !== "string" || text.length === 0) {
      throw new GoribuD1Error(
        "[Goribu] req.d1.unsafe(text, params) requires a non-empty SQL string. " +
          "Use the req.d1`...` tag unless the query structure itself must be dynamic.",
      );
    }
    if (!Array.isArray(params)) {
      throw new GoribuD1Error(
        "[Goribu] req.d1.unsafe(text, params) requires params to be an array of bound values. " +
          "Pass [] when the statement has no parameters.",
      );
    }
    return new Statement(execution, text, validateUnsafeParams(params));
  };

  if (atomic) {
    d1.atomic = (statements) => runAtomic(execution, statements);
  }

  Object.defineProperties(d1, {
    binding: {
      enumerable: true,
      get: resolveBinding,
    },
    session: {
      enumerable: true,
      get: getSession,
    },
  });

  if (mode !== undefined) {
    const rejectChaining = () => {
      throw new GoribuD1Error(
        `[Goribu] req.d1.${mode} cannot be chained with another D1 freshness mode. ` +
          "Use req.d1.fresh or req.d1.public directly.",
      );
    };
    Object.defineProperties(d1, {
      fresh: { get: rejectChaining },
      public: { get: rejectChaining },
    });
  }

  return d1;
}

function createBindingExecution(resolveBinding) {
  return {
    prepare(sql, params) {
      return bindStatement(resolveBinding(), sql, params);
    },
    batch(statements) {
      return resolveBinding().batch(statements);
    },
  };
}

function bindStatement(binding, sql, params) {
  const prepared = binding.prepare(sql);
  return params.length > 0 ? prepared.bind(...params) : prepared;
}

async function runAtomic(execution, statements) {
  // Argument validation stays outside the database-error wrapper: these are usage
  // mistakes (GoribuD1Error), not database failures.
  if (!Array.isArray(statements) || statements.length === 0) {
    throw new GoribuD1Error(
      "[Goribu] req.d1.atomic([...]) requires a non-empty array of unexecuted statements. " +
        "Pass req.d1`...` statements without a terminal method.",
    );
  }
  statements.forEach((statement, index) => {
    if (isStatement(statement)) return;
    if (isThenable(statement)) {
      throw new GoribuD1Error(
        `[Goribu] atomic() takes unexecuted statements, but statement ${index + 1} was a Promise.\n` +
          "Remove the terminal method: req.d1`INSERT ...` rather than req.d1`INSERT ...`.run().",
      );
    }
    throw new GoribuD1Error(
      `[Goribu] atomic() takes unexecuted statements, but statement ${index + 1} was not a req.d1 statement.\n` +
        "Pass req.d1`...` statements built by the tag, without a terminal method.",
    );
  });

  // Preparation, binding, the batch round trip, and result processing are all inside
  // the wrapper so a constraint or preparation failure reaches the caller normalized.
  try {
    const queries = statements.map(getStatementQuery);
    const capturedQueries =
      typeof execution.record === "function"
        ? queries.map(({ sql, params }) => captureQuery(execution, sql, params))
        : undefined;
    const prepared = queries.map(({ sql, params }) => execution.prepare(sql, params));
    const results = await execution.batch(prepared);
    for (let index = 0; index < results.length && index < queries.length; index += 1) {
      const { sql, params } = queries[index];
      reportQuery(
        execution,
        sql,
        params,
        results[index]?.meta,
        capturedQueries?.[index],
      );
    }
    return results.map((result) => ({
      rows: result?.results ?? [],
      changes: result?.meta?.changes,
      lastRowId: result?.meta?.last_row_id,
    }));
  } catch (cause) {
    throw wrapDatabaseError(cause);
  }
}

function isThenable(value) {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof value.then === "function"
  );
}
