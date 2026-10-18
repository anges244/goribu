import { afterEach, describe, expect, it } from "vitest";
import { createPostgresHandles } from "../src/postgres/create-postgres.js";

const binding = { connectionString: "postgres://app:secret@localhost:5432/app" };
const clients = new Set();
function track(sql) {
  clients.add(sql);
  return sql;
}
afterEach(async () => {
  try {
    await Promise.all([...clients].map((sql) => sql.end({ timeout: 0 })));
  } finally {
    clients.clear();
  }
});

describe("createPostgresHandles", () => {
  it("reads each binding only on its first use and memoizes the raw client", () => {
    const reads = { fresh: 0, cached: 0 };
    const handles = createPostgresHandles({
      get POSTGRES() { reads.fresh++; return binding; },
      get POSTGRES_CACHED() { reads.cached++; return binding; },
    });
    expect(Object.isFrozen(handles)).toBe(true);
    expect(reads).toEqual({ fresh: 0, cached: 0 });
    const fresh = track(handles.fresh());
    expect(typeof fresh).toBe("function");
    expect(reads).toEqual({ fresh: 1, cached: 0 });
    expect(handles.fresh()).toBe(fresh);
    expect(reads).toEqual({ fresh: 1, cached: 0 });
    const cached = track(handles.cached());
    expect(handles.cached()).toBe(cached);
    expect(reads).toEqual({ fresh: 1, cached: 1 });
  });

  it("creates independent clients with the settled options and static array support", () => {
    const env = { POSTGRES: binding, POSTGRES_CACHED: binding };
    const handles = createPostgresHandles(env);
    const fresh = track(handles.fresh());
    const cached = track(handles.cached());
    expect(cached).not.toBe(fresh);
    expect(fresh.options.max).toBe(3);
    expect(cached.options.max).toBe(2);
    for (const sql of [fresh, cached]) {
      expect(sql.options.fetch_types).toBe(false);
      expect(sql.options.prepare).toBe(true);
      expect(sql.options.parsers[1009]).toBeTypeOf("function");
      expect(sql.options.serializers[1009]).toBeTypeOf("function");
      expect(sql.options.shared.typeArrayMap[16]).toBe(1000);
    }
    expect(track(createPostgresHandles(env).fresh())).not.toBe(fresh);
  });

  it.each([
    ["fresh", "POSTGRES", "req.postgres"],
    ["cached", "POSTGRES_CACHED", "req.postgresCached"],
  ])("%s throws on every missing-binding call and allows retry", (method, name, field) => {
    const env = {};
    const handles = createPostgresHandles(env);
    const message = `[Goribu] ${field} was used but the ${name} Hyperdrive binding is missing from the Worker env. goribu.config.js declares database: { type: "postgres" }, so Goribu synthesizes this binding: restart \`goribu dev\`, or rerun \`goribu deploy\` to refresh the deployed bindings.`;
    expect(() => handles[method]()).toThrow(new Error(message));
    expect(() => handles[method]()).toThrow(new Error(message));
    env[name] = null;
    expect(() => handles[method]()).toThrow(new Error(message));
    env[name] = binding;
    track(handles[method]());
  });

  it.each([
    ["fresh", "POSTGRES"],
    ["cached", "POSTGRES_CACHED"],
  ])("%s rejects malformed bindings without memoizing failure", (method, name) => {
    const env = { [name]: {} };
    const handles = createPostgresHandles(env);
    for (const value of [{}, { connectionString: "" }, { connectionString: 42 }]) {
      env[name] = value;
      expect(() => handles[method]()).toThrow(new TypeError(
        `[Goribu] env.${name} is not a Hyperdrive binding. Pass the Worker env unchanged to app.fetch; in tests provide { connectionString: "postgres://user:password@host:5432/db" }.`,
      ));
    }
    env[name] = binding;
    track(handles[method]());
  });

  it("does not include a connection string's secret in a missing-binding error", () => {
    const handles = createPostgresHandles({
      POSTGRES: { connectionString: "postgres://app:s3cret-pass@localhost:5432/app" },
    });
    track(handles.fresh());
    let failure;
    try { handles.cached(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).not.toContain("s3cret-pass");
  });

  it("rejects env values that aren't non-null, non-array objects", () => {
    for (const env of [null, [], undefined, "bindings", 42]) {
      expect(() => createPostgresHandles(env)).toThrow(new TypeError(
        "[Goribu] createPostgresHandles(env) requires one request's Worker bindings. Pass env from the Worker fetch handler.",
      ));
    }
  });
});
