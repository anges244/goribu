import postgres from "postgres";
import { POSTGRES_ARRAY_TYPES, enableSqlArray } from "./array-types.js";

/** Create two lazy, raw Postgres.js clients for one request's Worker bindings. */
export function createPostgresHandles(env) {
  if (env === null || typeof env !== "object" || Array.isArray(env)) {
    throw new TypeError(
      "[Goribu] createPostgresHandles(env) requires one request's Worker bindings. Pass env from the Worker fetch handler.",
    );
  }

  // Cloudflare's Postgres.js guide creates a client per request and never ends it.
  // A res.stream body may query after the Response is returned (Phase 2a, T3);
  // workerd closes the sockets with the request's I/O context.
  function lazyClient(bindingName, requestField, max) {
    let sql;
    return () => {
      if (sql !== undefined) return sql;
      const binding = env[bindingName];
      if (binding === undefined || binding === null) {
        throw new Error(
          `[Goribu] ${requestField} was used but the ${bindingName} Hyperdrive binding is missing from the Worker env. goribu.config.js declares database: { type: "postgres" }, so Goribu synthesizes this binding: restart \`goribu dev\`, or rerun \`goribu deploy\` to refresh the deployed bindings.`,
        );
      }
      const connectionString = binding.connectionString;
      if (typeof connectionString !== "string" || connectionString.length === 0) {
        throw new TypeError(
          `[Goribu] env.${bindingName} is not a Hyperdrive binding. Pass the Worker env unchanged to app.fetch; in tests provide { connectionString: "postgres://user:password@host:5432/db" }.`,
        );
      }
      const client = postgres(connectionString, {
        max, fetch_types: false, prepare: true, types: POSTGRES_ARRAY_TYPES,
      });
      enableSqlArray(client);
      sql = client;
      return sql;
    };
  }

  return Object.freeze({
    fresh: lazyClient("POSTGRES", "req.postgres", 3),
    cached: lazyClient("POSTGRES_CACHED", "req.postgresCached", 2),
  });
}
