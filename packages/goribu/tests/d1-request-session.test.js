import { describe, expect, it, vi } from "vitest";
import { createD1BindingResolver } from "../src/db/create-d1-binding-resolver.js";
import { createD1RequestController as createController } from "../src/db/create-d1-request-controller.js";
import { createCookieJar } from "../src/runtime/cookies/create-cookie-jar.js";
import { createApp, defineConfig } from "goribu/server";

function createD1RequestController({ binding, ...options }) {
  return createController({ resolver: () => binding, ...options });
}

const BOOKMARK_COOKIE =
  "goribu_d1_bookmark=next; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax";

function createTarget({ bookmark = "next", bookmarkError, executionError, rowsRead = 1 } = {}) {
  let ran = false;
  const executions = [];
  const meta = {
    changes: 1,
    last_row_id: 1,
    rows_read: rowsRead,
    rows_written: 1,
    duration: 1,
  };

  function execute(method) {
    ran = true;
    executions.push(method);
    if (executionError) throw executionError;
  }

  function prepare(sql) {
    const record = { sql, params: [] };
    const statement = {
      record,
      bind(...params) {
        record.params = params;
        return statement;
      },
      async all() {
        execute("all");
        return { results: [], meta };
      },
      async run() {
        execute("run");
        return { meta };
      },
    };
    return statement;
  }

  const target = {
    prepare: vi.fn(prepare),
    batch: vi.fn(async (statements) => {
      execute("batch");
      return statements.map(() => ({ results: [], meta }));
    }),
    getBookmark: vi.fn(() => {
      if (bookmarkError) throw bookmarkError;
      return ran ? bookmark : null;
    }),
    executions,
  };
  return target;
}

function createSessionBinding(options = {}) {
  const raw = createTarget(options);
  const sessions = [];
  const binding = {
    prepare: raw.prepare,
    batch: raw.batch,
    withSession: vi.fn((constraint) => {
      const session = createTarget(options);
      sessions.push({ constraint, session });
      return session;
    }),
  };
  return { binding, raw, sessions };
}

describe("request-scoped D1 sessions", () => {
  it("keeps binding resolution lazy until terminal execution", async () => {
    const { binding } = createSessionBinding();
    const readBinding = vi.fn(() => binding);
    const env = {};
    Object.defineProperty(env, "DB", { get: readBinding });
    const controller = createController({
      resolver: createD1BindingResolver(env),
      cookieJar: createCookieJar(new Request("https://example.com/polls")),
    });
    const statement = controller.d1`SELECT 1`;

    void controller.d1.fresh;
    void controller.d1.public;
    await expect(controller.d1.atomic([])).rejects.toThrow(/non-empty array/);
    expect(readBinding).not.toHaveBeenCalled();

    await statement.get();
    expect(readBinding).toHaveBeenCalledOnce();
    controller.commit();
  });

  it("opens one lazy bookmarked session shared by statements and atomic, then commits an advanced bookmark", async () => {
    const request = new Request("https://example.com/polls", {
      headers: { cookie: "goribu_d1_bookmark=incoming" },
    });
    const cookieJar = createCookieJar(request);
    const { binding, raw, sessions } = createSessionBinding();
    const controller = createD1RequestController({ binding, cookieJar });
    const statement = controller.d1`SELECT * FROM polls WHERE id = ${1}`;

    expect(controller.d1.binding).toBe(binding);
    expect(binding.withSession).not.toHaveBeenCalled();

    await statement.get();
    await controller.d1.atomic([
      controller.d1`UPDATE polls SET title = ${"New"} WHERE id = ${1}`,
    ]);

    expect(binding.withSession).toHaveBeenCalledOnce();
    expect(binding.withSession).toHaveBeenCalledWith("incoming");
    expect(sessions[0].session.prepare).toHaveBeenCalledTimes(2);
    expect(sessions[0].session.batch).toHaveBeenCalledOnce();
    expect(raw.prepare).not.toHaveBeenCalled();
    expect(raw.batch).not.toHaveBeenCalled();

    controller.commit();
    controller.commit();
    expect(cookieJar.pending).toEqual([BOOKMARK_COOKIE]);
  });

  it("does not open a session or set a cookie when no query executes", async () => {
    const request = new Request("https://example.com/polls", {
      headers: { cookie: "goribu_d1_bookmark=incoming" },
    });
    const cookieJar = createCookieJar(request);
    const { binding } = createSessionBinding();
    const controller = createD1RequestController({ binding, cookieJar });

    controller.d1`SELECT 1`;
    void controller.d1.binding;
    await expect(controller.d1.atomic([])).rejects.toThrow(/non-empty array/);
    controller.commit();

    expect(binding.withSession).not.toHaveBeenCalled();
    expect(cookieJar.pending).toEqual([]);
  });

  it("starts unconstrained without a bookmark and does not rewrite an unchanged one", async () => {
    const withoutBookmark = createSessionBinding({ bookmark: null });
    const unconstrained = createD1RequestController({
      binding: withoutBookmark.binding,
      cookieJar: createCookieJar(new Request("https://example.com/polls")),
    });
    await unconstrained.d1`SELECT 1`.get();
    unconstrained.commit();
    expect(withoutBookmark.binding.withSession).toHaveBeenCalledWith(
      "first-unconstrained",
    );

    const request = new Request("https://example.com/polls", {
      headers: { cookie: "goribu_d1_bookmark=same" },
    });
    const cookieJar = createCookieJar(request);
    const { binding } = createSessionBinding({ bookmark: "same" });
    const controller = createD1RequestController({ binding, cookieJar });

    await controller.d1`SELECT 1`.get();
    controller.commit();

    expect(cookieJar.pending).toEqual([]);
  });

  it("routes fresh statements through one-shot primary sessions without touching the visitor bookmark", async () => {
    const request = new Request("https://example.com/polls", {
      headers: { cookie: "goribu_d1_bookmark=visitor" },
    });
    const cookieJar = createCookieJar(request);
    const { binding, sessions } = createSessionBinding();
    const controller = createD1RequestController({ binding, cookieJar });
    const first = controller.d1.fresh`SELECT * FROM accounts WHERE id = ${1}`;
    const second = controller.d1.fresh.unsafe("SELECT * FROM permissions WHERE id = ?", [2]);

    expect(binding.withSession).not.toHaveBeenCalled();
    await first.get();
    await second.all();
    controller.commit();

    expect(binding.withSession.mock.calls).toEqual([
      ["first-primary"],
      ["first-primary"],
    ]);
    expect(sessions[0].session.prepare).toHaveBeenCalledOnce();
    expect(sessions[1].session.prepare).toHaveBeenCalledOnce();
    expect(sessions[0].session.getBookmark).not.toHaveBeenCalled();
    expect(sessions[1].session.getBookmark).not.toHaveBeenCalled();
    expect(cookieJar.pending).toEqual([]);
  });

  it("reuses one unconstrained public session and never adopts its bookmark", async () => {
    const request = new Request("https://example.com/posts", {
      headers: { cookie: "goribu_d1_bookmark=visitor" },
    });
    const cookieJar = createCookieJar(request);
    const { binding, sessions } = createSessionBinding();
    const controller = createD1RequestController({ binding, cookieJar });

    await controller.d1.public`SELECT * FROM posts`.all();
    await controller.d1.public`UPDATE posts SET views = views + 1`.run();
    controller.commit();

    expect(binding.withSession).toHaveBeenCalledOnce();
    expect(binding.withSession).toHaveBeenCalledWith("first-unconstrained");
    expect(sessions[0].session.prepare).toHaveBeenCalledTimes(2);
    expect(sessions[0].session.getBookmark).not.toHaveBeenCalled();
    expect(cookieJar.pending).toEqual([]);
  });

  it("exposes stable default, fresh, and public sessions with their documented constraints", async () => {
    const request = new Request("https://example.com/polls", {
      headers: { cookie: "goribu_d1_bookmark=visitor" },
    });
    const { binding, sessions } = createSessionBinding();
    const controller = createD1RequestController({
      binding,
      cookieJar: createCookieJar(request),
    });

    const defaultSession = controller.d1.session;
    expect(controller.d1.session).toBe(defaultSession);
    await controller.d1`SELECT 1`.get();

    const publicSession = controller.d1.public.session;
    expect(controller.d1.public.session).toBe(publicSession);
    await controller.d1.public`SELECT 2`.get();

    const freshSession = controller.d1.fresh.session;
    expect(controller.d1.fresh.session).toBe(freshSession);
    await controller.d1.fresh`SELECT 3`.get();

    expect(binding.withSession.mock.calls).toEqual([
      ["visitor"],
      ["first-unconstrained"],
      ["first-primary"],
      ["first-primary"],
    ]);
    expect(sessions[0].session).toBe(defaultSession);
    expect(sessions[0].session.prepare).toHaveBeenCalledOnce();
    expect(sessions[1].session).toBe(publicSession);
    expect(sessions[1].session.prepare).toHaveBeenCalledOnce();
    expect(sessions[2].session).toBe(freshSession);
    expect(sessions[2].session.prepare).not.toHaveBeenCalled();
    expect(sessions[3].session.prepare).toHaveBeenCalledOnce();
  });

  it("rebinds fresh and public statements through the default owner in atomic", async () => {
    const request = new Request("https://example.com/polls", {
      headers: { cookie: "goribu_d1_bookmark=visitor" },
    });
    const { binding, sessions } = createSessionBinding();
    const controller = createD1RequestController({
      binding,
      cookieJar: createCookieJar(request),
    });

    await controller.d1.atomic([
      controller.d1.fresh`INSERT INTO events (kind) VALUES (${"fresh"})`,
      controller.d1.public`INSERT INTO events (kind) VALUES (${"public"})`,
    ]);

    expect(binding.withSession).toHaveBeenCalledOnce();
    expect(binding.withSession).toHaveBeenCalledWith("visitor");
    expect(sessions[0].session.prepare).toHaveBeenCalledTimes(2);
    expect(sessions[0].session.batch).toHaveBeenCalledOnce();
  });

  it("shares one recorder across default, fresh, public, and atomic execution", async () => {
    const { binding } = createSessionBinding();
    const recorder = { record: vi.fn(), finish: vi.fn() };
    const controller = createD1RequestController({
      binding,
      cookieJar: createCookieJar(new Request("https://example.com/polls")),
      recorder,
    });

    await controller.d1`SELECT ${1}`.get();
    await controller.d1.fresh`SELECT ${2}`.all();
    await controller.d1.public`UPDATE polls SET views = ${3}`.run();
    await controller.d1.atomic([
      controller.d1`INSERT INTO polls (id) VALUES (${4})`,
      controller.d1.public`DELETE FROM polls WHERE id = ${5}`,
    ]);
    controller.commit();
    controller.commit();

    expect(recorder.record.mock.calls.map(([query]) => [query.sql, query.params])).toEqual([
      ["SELECT ?", [1]],
      ["SELECT ?", [2]],
      ["UPDATE polls SET views = ?", [3]],
      ["INSERT INTO polls (id) VALUES (?)", [4]],
      ["DELETE FROM polls WHERE id = ?", [5]],
    ]);
    expect(recorder.record).toHaveBeenCalledTimes(5);
    expect(recorder.finish).toHaveBeenCalledOnce();
  });

  it("rejects freshness-mode chaining and keeps atomic only on the default facade", () => {
    const { binding } = createSessionBinding();
    const controller = createD1RequestController({
      binding,
      cookieJar: createCookieJar(new Request("https://example.com/polls")),
    });

    expect(controller.d1.fresh.binding).toBe(binding);
    expect(controller.d1.public.binding).toBe(binding);
    expect(controller.d1.fresh.atomic).toBeUndefined();
    expect(controller.d1.public.atomic).toBeUndefined();
    expect(() => controller.d1.fresh.public).toThrow(/cannot be chained/);
    expect(() => controller.d1.public.fresh).toThrow(/cannot be chained/);
    expect(binding.withSession).not.toHaveBeenCalled();
  });

  it("uses the raw binding for every mode and recorder when replication is off", async () => {
    const request = new Request("https://example.com/polls", {
      headers: { cookie: "goribu_d1_bookmark=ignored" },
    });
    const cookieJar = createCookieJar(request);
    const { binding, raw } = createSessionBinding();
    const recorder = { record: vi.fn(), finish: vi.fn() };
    const controller = createD1RequestController({
      binding,
      cookieJar,
      replication: false,
      recorder,
    });

    expect(controller.d1.session).toBe(binding);
    expect(controller.d1.fresh.session).toBe(binding);
    expect(controller.d1.public.session).toBe(binding);
    await controller.d1`SELECT 1`.get();
    await controller.d1.fresh`SELECT 2`.get();
    await controller.d1.public`SELECT 3`.get();
    await controller.d1.atomic([controller.d1.fresh`DELETE FROM polls`]);
    controller.commit();

    expect(binding.withSession).not.toHaveBeenCalled();
    expect(raw.prepare).toHaveBeenCalledTimes(4);
    expect(raw.batch).toHaveBeenCalledOnce();
    expect(recorder.record).toHaveBeenCalledTimes(4);
    expect(recorder.finish).toHaveBeenCalledOnce();
    expect(cookieJar.pending).toEqual([]);
  });

  it("falls back once when withSession rejects the incoming bookmark without retrying query failures", async () => {
    const request = new Request("https://example.com/polls", {
      headers: { cookie: "goribu_d1_bookmark=stale" },
    });
    const cookieJar = createCookieJar(request);
    const { binding } = createSessionBinding();
    binding.withSession.mockImplementationOnce(() => {
      throw new Error("bookmark is too old");
    });
    const controller = createD1RequestController({ binding, cookieJar });

    await controller.d1`SELECT 1`.get();
    controller.commit();

    expect(binding.withSession).toHaveBeenNthCalledWith(1, "stale");
    expect(binding.withSession).toHaveBeenNthCalledWith(2, "first-unconstrained");
    expect(cookieJar.pending).toEqual([BOOKMARK_COOKIE]);

    const queryFailure = new Error("network failed after execution started");
    const failing = createSessionBinding({ executionError: queryFailure });
    const failingController = createD1RequestController({
      binding: failing.binding,
      cookieJar: createCookieJar(request),
    });
    await expect(failingController.d1`UPDATE polls SET title = ${"x"}`.run()).rejects.toMatchObject({
      cause: queryFailure,
    });
    expect(failing.binding.withSession).toHaveBeenCalledOnce();
    expect(failing.sessions[0].session.executions).toEqual(["run"]);
  });

  it.each([
    ["a throwing getBookmark", { bookmarkError: new Error("bookmark unavailable") }],
    ["a malformed bookmark", { bookmark: { invalid: true } }],
  ])("keeps unrelated pending cookies when commit sees %s", async (_label, targetOptions) => {
    const request = new Request("https://example.com/polls");
    const cookieJar = createCookieJar(request);
    const { binding } = createSessionBinding(targetOptions);
    const controller = createD1RequestController({ binding, cookieJar });

    cookieJar.set("auth", "preserved", { path: "/", httpOnly: true });
    await controller.d1`SELECT 1`.get();

    expect(() => controller.commit()).not.toThrow();
    expect(cookieJar.pending).toEqual(["auth=preserved; Path=/; HttpOnly"]);
  });
});

const routeFilePath = "/app/src/routes/session.js";
const route = {
  id: "src/routes/session.js",
  filePath: routeFilePath,
  pattern: "/session",
  segments: [{ type: "static", value: "session" }],
  hasDefaultExport: false,
  methods: ["GET"],
};

describe("D1 session runtime lifecycle", () => {
  it.each([
    ["production", false, 200],
    ["production", true, 500],
    ["development", false, 200],
    ["development", true, 500],
  ])("commits before the %s %s response cookie snapshot", async (mode, fail, status) => {
    const { binding } = createSessionBinding();
    const app = createSessionApp({ mode, fail });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await app.fetch(
        new Request("https://example.com/session", {
          headers: { cookie: "goribu_d1_bookmark=before" },
        }),
        { DB: binding },
        { waitUntil() {} },
      );

      expect(response.status).toBe(status);
      expect(response.headers.getSetCookie()).toContain(BOOKMARK_COOKIE);
      expect(binding.withSession).toHaveBeenCalledWith("before");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("preserves a produced response when bookmark commit fails", async () => {
    const { binding } = createSessionBinding({
      bookmarkError: new Error("bookmark unavailable"),
    });
    const app = createSessionApp({ mode: "production" });

    const response = await app.fetch(
      new Request("https://example.com/session"),
      { DB: binding },
      { waitUntil() {} },
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("updated");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("keeps full runtime requests lazy when application and framework responses do not use D1", async () => {
    const { binding } = createSessionBinding();
    const readBinding = vi.fn(() => binding);
    const env = {};
    Object.defineProperty(env, "DB", { get: readBinding });
    const app = createSessionApp({ mode: "production", useD1: false });

    for (const pathname of ["/session", "/missing"]) {
      const response = await app.fetch(
        new Request(`https://example.com${pathname}`, {
          headers: { cookie: "goribu_d1_bookmark=incoming" },
        }),
        env,
        { waitUntil() {} },
      );
      expect(response.headers.getSetCookie()).toEqual([]);
    }

    expect(readBinding).not.toHaveBeenCalled();
    expect(binding.withSession).not.toHaveBeenCalled();
  });

  it("honors replication false through public configuration", async () => {
    const { binding, raw } = createSessionBinding();
    const app = createSessionApp({
      mode: "production",
      replication: false,
      includeAtomic: true,
    });

    const response = await app.fetch(
      new Request("https://example.com/session", {
        headers: { cookie: "goribu_d1_bookmark=ignored" },
      }),
      { DB: binding },
      { waitUntil() {} },
    );

    expect(response.status).toBe(200);
    expect(binding.withSession).not.toHaveBeenCalled();
    expect(raw.prepare).toHaveBeenCalledTimes(2);
    expect(raw.batch).toHaveBeenCalledOnce();
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

function createSessionApp({
  mode,
  fail = false,
  replication,
  useD1 = true,
  useGet = false,
  includeAtomic = false,
}) {
  return createApp({
    mode,
    manifest: [route],
    errorPages: { notFound: null, serverError: null },
    middlewareByRoute: new Map([[route.id, []]]),
    modules: new Map([
      [route.id, {
        async GET(request, response) {
          if (
            (useD1 || useGet || includeAtomic) &&
            request.d1.binding !== request.env.DB
          ) {
            throw new Error("req.d1.binding did not preserve env.DB");
          }
          if (useD1) {
            await request.d1`UPDATE visits SET count = count + 1`.run();
          }
          if (useGet) {
            await request.d1`SELECT * FROM polls WHERE author_id = ${1}`.get();
          }
          if (includeAtomic) {
            await request.d1.atomic([
              request.d1`INSERT INTO visits (count) VALUES (${1})`,
            ]);
          }
          if (fail) throw new Error("handler failed after write");
          return response.text("updated");
        },
      }],
    ]),
    applicationConfig: defineConfig({
      name: "session-test",
      compatibilityDate: "2026-09-03",
      database: {
        type: "d1",
        name: "session-test",
        ...(replication === undefined ? {} : { replication }),
      },
    }),
  });
}
