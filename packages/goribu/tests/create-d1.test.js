import { describe, expect, it } from "vitest";
import { createD1 as createD1FromResolver } from "../src/db/create-d1.js";
import { createD1BindingResolver } from "../src/db/create-d1-binding-resolver.js";
import { GoribuD1Error, wrapDatabaseError } from "../src/db/goribu-d1-error.js";
import { createRequest } from "../src/runtime/create-request.js";

function createD1(binding, execution, modes) {
  return createD1FromResolver(() => binding, execution, modes);
}

/**
 * A stub D1 binding implementing the statement interface Goribu uses: prepare()/bind()
 * and metadata-bearing all()/run(), plus batch(). This is the dependency-free test
 * surface the docs sanction; it records the SQL and bound params each call received
 * and returns caller-supplied results. Behavior hooks let a test make preparation,
 * binding, execution, or the batch round trip throw.
 */
function createMockD1(behavior = {}) {
  const executed = [];
  const batched = [];
  const meta = behavior.meta ?? {
    changes: 0,
    last_row_id: 0,
    rows_read: 1,
    rows_written: 0,
    duration: 1,
  };

  function prepare(sql) {
    const record = { sql, params: [] };
    const throwing = (method) => async () => {
      executed.push({ method, ...record });
      throw behavior.throw;
    };
    const statement = {
      record,
      bind(...params) {
        if (behavior.bindThrow) throw behavior.bindThrow;
        record.params = params;
        return statement;
      },
      all: behavior.throw
        ? throwing("all")
        : async () => {
            executed.push({ method: "all", ...record });
            return { results: behavior.all ?? [], meta };
          },
      run: behavior.throw
        ? throwing("run")
        : async () => {
            executed.push({ method: "run", ...record });
            return { meta };
          },
    };
    return statement;
  }

  const binding = {
    prepare,
    async batch(statements) {
      for (const statement of statements) {
        batched.push({ ...statement.record });
      }
      if (behavior.batchThrow) throw behavior.batchThrow;
      return behavior.batch ?? statements.map(() => ({ results: [], meta }));
    },
  };

  return { binding, executed, batched };
}

function createRecordedExecution(binding, record) {
  return {
    prepare(sql, params) {
      const statement = binding.prepare(sql);
      return params.length > 0 ? statement.bind(...params) : statement;
    },
    batch(statements) {
      return binding.batch(statements);
    },
    record,
  };
}

describe("createD1 tag and interpolation", () => {
  it("binds a single value as one placeholder", async () => {
    const { binding, executed } = createMockD1({ all: [] });
    await createD1(binding)`SELECT * FROM polls WHERE id = ${5}`.get();
    expect(executed).toEqual([
      { method: "all", sql: "SELECT * FROM polls WHERE id = ?", params: [5] },
    ]);
  });

  it("expands a non-empty array in the middle of other values", async () => {
    const { binding, executed } = createMockD1({ all: [] });
    await createD1(binding)`SELECT ${1} FROM t WHERE id IN (${[10, 20, 30]}) AND name = ${"a"}`.all();
    expect(executed[0].sql).toBe("SELECT ? FROM t WHERE id IN (?, ?, ?) AND name = ?");
    expect(executed[0].params).toEqual([1, 10, 20, 30, "a"]);
  });

  it("handles a query with no interpolated values", async () => {
    const { binding, executed } = createMockD1({ all: [{ count: 0 }] });
    await createD1(binding)`SELECT count(*) FROM polls`.value();
    expect(executed[0].sql).toBe("SELECT count(*) FROM polls");
    expect(executed[0].params).toEqual([]);
  });

  it("binds booleans as 1 and 0, and null as-is", async () => {
    const { binding, executed } = createMockD1({ meta: {} });
    await createD1(binding)`INSERT INTO t VALUES (${true}, ${false}, ${null})`.run();
    expect(executed[0].params).toEqual([1, 0, null]);
  });

  it("rejects ordinary arrays with assembled SQL, including arrays carrying raw", () => {
    const { binding } = createMockD1();
    const d1 = createD1(binding);
    const assembled = "SELECT * FROM users WHERE name = 'x'";
    expect(() => d1([assembled])).toThrow(/must be used as a tagged template/);
    expect(() => d1([assembled])).toThrow(/req\.d1\.unsafe/);

    const withRaw = [assembled];
    withRaw.raw = Object.freeze([assembled]);
    Object.freeze(withRaw);
    expect(() => d1(withRaw)).toThrow(/must be used as a tagged template/);
  });

  it("rejects an empty array, naming its position", () => {
    const { binding } = createMockD1();
    const d1 = createD1(binding);
    expect(() => d1`a ${1} b ${[]} c ${3}`).toThrow(
      /empty array into a query \(value 2 of 3\)/s,
    );
  });

  it("rejects undefined with the null repair, naming its position", () => {
    const { binding } = createMockD1();
    expect(() => createD1(binding)`x ${undefined}`).toThrow(
      /Cannot interpolate undefined into a query \(value 1 of 1\)[\s\S]*Use null/s,
    );
  });

  it("rejects a Date, teaching toISOString", () => {
    const { binding } = createMockD1();
    expect(() => createD1(binding)`${new Date()}`).toThrow(
      /Cannot interpolate a Date into a query \(value 1 of 1\)[\s\S]*toISOString/s,
    );
  });

  it("rejects an object and a nested array with the object message", () => {
    const { binding } = createMockD1();
    const d1 = createD1(binding);
    expect(() => d1`${1} ${{ a: 1 }}`).toThrow(
      /Cannot interpolate an object into a query \(value 2 of 2\)/s,
    );
    expect(() => d1`${[[1, 2]]}`).toThrow(/Cannot interpolate an object/s);
  });
});

describe("createD1 statement immutability", () => {
  it("does not expose writable sql or params to mutate into arbitrary SQL", async () => {
    const { binding, executed } = createMockD1({ all: [] });
    const statement = createD1(binding)`SELECT * FROM t WHERE id = ${1}`;
    // Assigning these must not change the SQL that reaches the database.
    statement.sql = "SELECT * FROM secrets";
    statement.params = ["injected"];
    await statement.get();
    expect(executed[0].sql).toBe("SELECT * FROM t WHERE id = ?");
    expect(executed[0].params).toEqual([1]);
  });
});

describe("createD1 unsafe", () => {
  it("builds an equivalent statement from literal text and validated params", async () => {
    const { binding, executed } = createMockD1({ all: [] });
    await createD1(binding)
      .unsafe("SELECT * FROM t ORDER BY name DESC LIMIT ?", [10])
      .all();
    expect(executed[0].sql).toBe("SELECT * FROM t ORDER BY name DESC LIMIT ?");
    expect(executed[0].params).toEqual([10]);
  });

  it("coerces booleans but rejects arrays in params", async () => {
    const { binding, executed } = createMockD1({ all: [] });
    const d1 = createD1(binding);
    await d1.unsafe("SELECT ?", [true]).all();
    expect(executed[0].params).toEqual([1]);
    expect(() => d1.unsafe("SELECT ?", [[1, 2]])).toThrow(
      /array as unsafe\(\) parameter 1 of 1/,
    );
  });

  it("requires a non-empty string and an array of params", () => {
    const { binding } = createMockD1();
    const d1 = createD1(binding);
    expect(() => d1.unsafe("")).toThrow(/non-empty SQL string/);
    expect(() => d1.unsafe("SELECT 1", "nope")).toThrow(/params to be an array/);
  });
});

describe("createD1 terminal methods", () => {
  it("get returns the first all() row or null", async () => {
    expect(await createD1(createMockD1({ all: [] }).binding)`SELECT 1`.get()).toBeNull();
    expect(
      await createD1(createMockD1({ all: [{ id: 1 }, { id: 2 }] }).binding)`SELECT 1`.get(),
    ).toEqual({ id: 1 });
  });

  it("all returns rows or []", async () => {
    expect(await createD1(createMockD1({ all: [] }).binding)`SELECT 1`.all()).toEqual([]);
    expect(
      await createD1(createMockD1({ all: [{ id: 1 }] }).binding)`SELECT 1`.all(),
    ).toEqual([{ id: 1 }]);
  });

  it("value returns the first object column or null", async () => {
    expect(await createD1(createMockD1({ all: [] }).binding)`SELECT 1`.value()).toBeNull();
    expect(
      await createD1(createMockD1({ all: [{ answer: null }] }).binding)`SELECT 1`.value(),
    ).toBeNull();
    expect(
      await createD1(
        createMockD1({ all: [{ selected_second: 42, ignored: 9 }] }).binding,
      )`SELECT 1`.value(),
    ).toBe(42);
  });

  it("reports metadata for every terminal before returning its public result", async () => {
    const meta = {
      changes: 2,
      last_row_id: 9,
      rows_read: 7,
      rows_written: 3,
      duration: 4.5,
    };
    const target = createMockD1({ all: [{ answer: 42, ignored: 9 }], meta });
    const recorded = [];
    const d1 = createD1(
      target.binding,
      createRecordedExecution(target.binding, (query) => recorded.push(query)),
    );

    await d1`SELECT * FROM t WHERE id = ${1}`.get();
    await d1`SELECT * FROM t WHERE id = ${2}`.all();
    await d1`SELECT answer, ignored FROM t WHERE id = ${3}`.value();
    await d1`UPDATE t SET answer = ${4}`.run();

    expect(target.executed.map(({ method }) => method)).toEqual([
      "all",
      "all",
      "all",
      "run",
    ]);
    expect(recorded).toEqual([
      { sql: "SELECT * FROM t WHERE id = ?", params: [1], meta, terminal: "get" },
      { sql: "SELECT * FROM t WHERE id = ?", params: [2], meta, terminal: "all" },
      {
        sql: "SELECT answer, ignored FROM t WHERE id = ?",
        params: [3],
        meta,
        terminal: "value",
      },
      { sql: "UPDATE t SET answer = ?", params: [4], meta, terminal: "run" },
    ]);
  });

  it("keeps recorder failures from changing a successful query", async () => {
    const target = createMockD1({ all: [{ id: 1 }] });
    const d1 = createD1(
      target.binding,
      createRecordedExecution(target.binding, () => {
        throw new Error("recorder failed");
      }),
    );

    await expect(d1`SELECT 1`.get()).resolves.toEqual({ id: 1 });
  });

  it("run maps meta to { changes, lastRowId }", async () => {
    const { binding } = createMockD1({
      meta: {
        changes: 2,
        last_row_id: 9,
        rows_read: 0,
        rows_written: 2,
        duration: 1,
      },
    });
    expect(await createD1(binding)`DELETE FROM t`.run()).toEqual({
      changes: 2,
      lastRowId: 9,
    });
  });

  it("rejects a statement awaited without a terminal method", async () => {
    const { binding, executed } = createMockD1();
    await expect(createD1(binding)`DELETE FROM t WHERE id = ${1}`).rejects.toThrow(
      /awaited without being run/,
    );
    expect(executed).toEqual([]);
  });
});

describe("createD1 atomic", () => {
  it("returns and reports one result per statement in order", async () => {
    const firstMeta = {
      changes: 1,
      last_row_id: 2,
      rows_read: 1,
      rows_written: 1,
      duration: 2,
    };
    const secondMeta = {
      changes: 0,
      last_row_id: 0,
      rows_read: 2,
      rows_written: 0,
      duration: 3,
    };
    const { binding, batched } = createMockD1({
      batch: [
        { results: [{ a: 1 }], meta: firstMeta },
        { results: [], meta: secondMeta },
      ],
    });
    const recorded = [];
    const d1 = createD1(
      binding,
      createRecordedExecution(binding, (query) => recorded.push(query)),
    );
    const results = await d1.atomic([
      d1`INSERT INTO t (id) VALUES (${1})`,
      d1`DELETE FROM t WHERE id = ${2}`,
    ]);

    expect(results).toEqual([
      { rows: [{ a: 1 }], changes: 1, lastRowId: 2 },
      { rows: [], changes: 0, lastRowId: 0 },
    ]);
    expect(batched).toEqual([
      { sql: "INSERT INTO t (id) VALUES (?)", params: [1] },
      { sql: "DELETE FROM t WHERE id = ?", params: [2] },
    ]);
    expect(recorded).toEqual([
      { sql: "INSERT INTO t (id) VALUES (?)", params: [1], meta: firstMeta },
      { sql: "DELETE FROM t WHERE id = ?", params: [2], meta: secondMeta },
    ]);
  });

  it("rejects a promise in the array, naming the position", async () => {
    const { binding } = createMockD1({ meta: {} });
    const d1 = createD1(binding);
    await expect(
      d1.atomic([d1`INSERT INTO t (id) VALUES (${1})`, d1`INSERT INTO t (id) VALUES (${2})`.run()]),
    ).rejects.toThrow(/statement 2 was a Promise/);
  });

  it("rejects a non-statement and an empty array", async () => {
    const { binding } = createMockD1();
    const d1 = createD1(binding);
    await expect(d1.atomic([d1`INSERT INTO t DEFAULT VALUES`, {}])).rejects.toThrow(
      /statement 2 was not a req\.d1 statement/,
    );
    await expect(d1.atomic([])).rejects.toThrow(/non-empty array of unexecuted statements/);
  });

  it("normalizes a failure from the batch round trip", async () => {
    const cause = new Error("UNIQUE constraint failed: t.id");
    const { binding } = createMockD1({ batchThrow: cause });
    const d1 = createD1(binding);
    try {
      await d1.atomic([d1`INSERT INTO t (id) VALUES (${1})`]);
      throw new Error("expected the batch to reject");
    } catch (error) {
      expect(error.constraint).toBe("unique");
      expect(error.cause).toBe(cause);
    }
  });

  it("normalizes a binding error raised during preparation", async () => {
    const cause = new Error("D1_ERROR: too many SQL variables");
    const { binding } = createMockD1({ bindThrow: cause });
    const d1 = createD1(binding);
    await expect(
      d1.atomic([d1`INSERT INTO t (id) VALUES (${1})`]),
    ).rejects.toMatchObject({ name: "GoribuDatabaseError", cause });
  });

  it("rebinds every statement through the atomic owner's binding", async () => {
    const owner = createMockD1();
    const other = createMockD1({
      bindThrow: new Error("the statement context must be ignored"),
    });
    const ownerD1 = createD1(owner.binding);
    const otherD1 = createD1(other.binding);

    await expect(
      ownerD1.atomic([otherD1`INSERT INTO t (id) VALUES (${1})`]),
    ).resolves.toEqual([{ rows: [], changes: 0, lastRowId: 0 }]);
    expect(owner.batched).toEqual([
      { sql: "INSERT INTO t (id) VALUES (?)", params: [1] },
    ]);
  });
});

describe("D1 constraint errors", () => {
  it("normalizes each SQLite constraint kind, D1 wrapping included", () => {
    const unique = wrapDatabaseError(
      new Error("D1_ERROR: UNIQUE constraint failed: users.email: SQLITE_CONSTRAINT"),
    );
    expect(unique.constraint).toBe("unique");
    expect(unique.table).toBe("users");
    expect(unique.columns).toEqual(["email"]);
    expect(unique.message).toBe(
      "D1_ERROR: UNIQUE constraint failed: users.email: SQLITE_CONSTRAINT",
    );

    const composite = wrapDatabaseError(
      new Error("UNIQUE constraint failed: workspaces.workspace_id, workspaces.slug"),
    );
    expect(composite.table).toBe("workspaces");
    expect(composite.columns).toEqual(["workspace_id", "slug"]);

    const notNull = wrapDatabaseError(new Error("NOT NULL constraint failed: posts.title"));
    expect(notNull.constraint).toBe("notNull");
    expect(notNull.columns).toEqual(["title"]);

    const foreignKey = wrapDatabaseError(new Error("FOREIGN KEY constraint failed"));
    expect(foreignKey.constraint).toBe("foreignKey");
    expect(foreignKey.table).toBeUndefined();
    expect(foreignKey.columns).toBeUndefined();

    const check = wrapDatabaseError(
      new Error("D1_ERROR: CHECK constraint failed: price_positive: SQLITE_CONSTRAINT"),
    );
    expect(check.constraint).toBe("check");
    expect(check.constraintName).toBe("price_positive");
  });

  it("passes an unrecognized message through unannotated and never throws", () => {
    const error = wrapDatabaseError(new Error("network blip"));
    expect(error.constraint).toBeUndefined();
    expect(error.message).toBe("network blip");
    expect(() => wrapDatabaseError({})).not.toThrow();
    expect(() => wrapDatabaseError(null)).not.toThrow();
  });

  it("survives a hostile cause whose message cannot be read", () => {
    expect(() => wrapDatabaseError(Object.create(null))).not.toThrow();
    const throwingMessage = {
      get message() {
        throw new Error("no peeking");
      },
    };
    const error = wrapDatabaseError(throwingMessage);
    expect(error.name).toBe("GoribuDatabaseError");
    expect(error.cause).toBe(throwingMessage);
    expect(typeof error.message).toBe("string");
  });

  it("wraps a failure thrown by a terminal method, preserving the cause", async () => {
    const cause = new Error("UNIQUE constraint failed: users.email");
    const { binding } = createMockD1({ throw: cause });
    const d1 = createD1(binding);
    try {
      await d1`INSERT INTO users (email) VALUES (${"a@b.c"})`.run();
      throw new Error("expected the write to reject");
    } catch (error) {
      expect(error.constraint).toBe("unique");
      expect(error.columns).toEqual(["email"]);
      expect(error.cause).toBe(cause);
    }
  });
});

describe("createD1 missing binding", () => {
  it("preserves the resolver's teaching usage error through lazy execution", async () => {
    for (const absent of [undefined, null]) {
      const d1 = createD1FromResolver(createD1BindingResolver({ DB: absent }));
      const statement = d1`SELECT 1`;

      await expect(statement.get()).rejects.toBeInstanceOf(GoribuD1Error);
      await expect(d1.unsafe("SELECT 1").all()).rejects.toThrow(
        /no D1 binding was found/,
      );
      await expect(d1.atomic([d1`SELECT 1`])).rejects.toBeInstanceOf(
        GoribuD1Error,
      );
      expect(() => d1.binding.prepare("SELECT 1")).toThrow(
        /no D1 binding was found/,
      );
      expect(() => d1.session.prepare("SELECT 1")).toThrow(
        /no D1 binding was found/,
      );
      await expect(d1.fresh`SELECT 1`.get()).rejects.toBeInstanceOf(
        GoribuD1Error,
      );
      await expect(d1.public`SELECT 1`.get()).rejects.toBeInstanceOf(
        GoribuD1Error,
      );
    }
  });
});

describe("req.d1 wiring", () => {
  it("passes the request-scoped facade through to req.d1", async () => {
    const { binding } = createMockD1();
    const facade = createD1(binding);
    const withDb = createRequest(new Request("https://example.com/"), {}, {
      env: { DB: binding },
      d1: facade,
    });
    expect(withDb.d1).toBe(facade);
    expect(withDb.d1.binding).toBe(binding);
    expect(withDb.d1.session).toBe(binding);
    expect(withDb.d1.fresh.session).toBe(binding);
    expect(withDb.d1.public.session).toBe(binding);

    const withoutDb = createRequest(new Request("https://example.com/"), {}, {
      env: {},
      d1: createD1FromResolver(createD1BindingResolver({})),
    });
    await expect(withoutDb.d1`SELECT 1`.get()).rejects.toThrow(/Expected env\.DB/);
  });
});
