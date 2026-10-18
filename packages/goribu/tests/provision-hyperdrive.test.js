import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { readPostgresEnv } from "../src/build/postgres/read-postgres-env.js";
import { provisionHyperdrive } from "../src/build/postgres/provision-hyperdrive.js";

vi.mock("../src/build/postgres/read-postgres-env.js", () => ({ readPostgresEnv: vi.fn() }));

const base = { name: "app", compatibilityDate: "2026-09-23" };
const appConfig = defineConfig({ ...base, database: { type: "postgres" } });
const access = { accountId: "account", headers: { Authorization: "Bearer test-token" } };
const names = ["app-postgres", "app-postgres-cached"];
const ids = ["a".repeat(32), "b".repeat(32)];
const byoConfig = defineConfig({ ...base, database: {
  type: "postgres", hyperdriveId: ids[0], hyperdriveCachedId: ids[1],
} });
let password;
let env;

// Credentials exist only in memory, including failures: assert booleans, never body diffs.
function connection({ host = "db.example.test", port = 5432, scheme = "postgresql", parameters = "" } = {}) {
  return `${scheme}://${encodeURIComponent("app role")}:${encodeURIComponent(password)}@${host}:${port}/app%2Fdb${parameters}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  password = randomBytes(24).toString("base64");
  env = {
    url: { value: connection(), source: "POSTGRES_URL in .env.production" },
    migrateUrl: { value: connection({ host: "migration.example.test" }), source: "POSTGRES_MIGRATE_URL in .env.production" },
  };
  readPostgresEnv.mockImplementation(() => env);
});

function config(index, overrides = {}) {
  return { id: ids[index], name: names[index], caching: { disabled: index === 0 }, ...overrides };
}

function success(result, extra = {}) {
  return Response.json({ success: true, result, ...extra });
}

function listed(result = [], total_pages = 1) {
  return success(result, { result_info: { total_pages } });
}

function harness(respond) {
  const calls = [];
  let output = "";
  const fetch = vi.fn(async (url, options) => {
    const call = { url: new URL(url), ...options, body: options.body === undefined ? undefined : JSON.parse(options.body) };
    calls.push(call);
    return respond(call, calls.length);
  });
  return {
    calls, fetch,
    output: () => output,
    run: (overrides = {}) => provisionHyperdrive({
      projectRoot: "/app", appConfig, access, fetch,
      stdout: { write(text) { output += text; } }, ...overrides,
    }),
  };
}

function managedServer(inventory = []) {
  return harness(({ method, url, body }) => {
    if (method === "GET") return listed(inventory);
    const index = method === "POST" ? names.indexOf(body.name) : ids.indexOf(url.pathname.split("/").at(-1));
    const result = config(index, { caching: body.caching });
    inventory[index] = result; // Like Cloudflare, the response never supplies a password.
    return success(result);
  });
}

function expectPrivate(h, error) {
  const diagnostic = h.output() + (error ? String(error) + error.stack : "");
  expect(diagnostic.includes(password)).toBe(false);
  expect(diagnostic.includes(encodeURIComponent(password))).toBe(false);
  expect(diagnostic.includes(env.url.value)).toBe(false);
  expect(diagnostic.includes(env.migrateUrl.value)).toBe(false);
  if (error) expect(error.cause).toBeUndefined();
}

describe("Hyperdrive provisioning", () => {
  it("creates both configs from the app role, with explicit caching modes and no mtls by default", async () => {
    const h = managedServer();
    await expect(h.run()).resolves.toEqual({ id: ids[0], cachedId: ids[1] });
    expect(readPostgresEnv).toHaveBeenCalledWith({ projectRoot: "/app", target: "production" });
    expect(h.calls.map(({ method }) => method)).toEqual(["GET", "POST", "POST"]);
    for (const [index, call] of h.calls.slice(1).entries()) {
      expect(call.url.pathname).toBe("/client/v4/accounts/account/hyperdrive/configs");
      expect(call.redirect).toBe("error");
      expect(call.headers).toEqual({ ...access.headers, "Content-Type": "application/json" });
      expect(call.body.name).toBe(names[index]);
      expect(call.body.caching).toEqual({ disabled: index === 0 });
      expect(Object.hasOwn(call.body, "mtls")).toBe(false);
      const { password: sent, ...origin } = call.body.origin;
      expect(sent === password).toBe(true);
      expect(origin).toEqual({ scheme: "postgresql", host: "db.example.test", port: 5432, database: "app/db", user: "app role" });
    }
    expect(h.output()).toBe("✓ Created Hyperdrive config app-postgres\n✓ Created Hyperdrive config app-postgres-cached\n");
    expectPrivate(h);
  });

  it("PATCHes both on every later deploy, rotating the password and repairing caching drift", async () => {
    const inventory = [];
    const h = managedServer(inventory);
    await h.run();
    const firstPassword = password;
    password = randomBytes(24).toString("base64");
    env.url.value = connection({ scheme: "postgres" });
    inventory[0].caching.disabled = false;
    inventory[1].caching.disabled = true;
    await expect(h.run()).resolves.toEqual({ id: ids[0], cachedId: ids[1] });
    expect(h.calls.slice(3).map(({ method }) => method)).toEqual(["GET", "PATCH", "PATCH"]);
    for (const [index, call] of h.calls.slice(4).entries()) {
      expect(call.url.pathname.endsWith(`/${ids[index]}`)).toBe(true);
      expect(call.body.origin.password === password && call.body.origin.password !== firstPassword).toBe(true);
      expect(call.body.origin.scheme).toBe("postgres");
      expect(call.body.caching).toEqual({ disabled: index === 0 });
      expect(Object.hasOwn(call.body, "name")).toBe(false);
    }
    expect(h.output()).toContain("✓ Updated Hyperdrive config app-postgres\n✓ Updated Hyperdrive config app-postgres-cached\n");
    expectPrivate(h);
  });

  it("finds exact names on page 2 and creates only the missing config", async () => {
    const h = harness(({ method, url }, count) => {
      if (method === "GET") {
        expect(url.searchParams.get("page")).toBe(String(count));
        return listed(count === 1 ? [config(0, { name: "app-postgres-other" })] : [config(1)], 2);
      }
      return success(config(method === "POST" ? 0 : 1));
    });
    await expect(h.run()).resolves.toEqual({ id: ids[0], cachedId: ids[1] });
    expect(h.calls.map(({ method }) => method)).toEqual(["GET", "GET", "POST", "PATCH"]);
  });

  it.each([0, 1])("refuses duplicate config %i across pages before any write", async (index) => {
    const h = harness((call, count) => listed([config(index, { id: String(count) })], 2));
    await expect(h.run()).rejects.toThrow(`More than one Hyperdrive config is named ${names[index]}`);
    expect(h.calls.map(({ method }) => method)).toEqual(["GET", "GET"]);
  });

  it("GETs both BYO IDs without reading env or modifying origins", async () => {
    readPostgresEnv.mockImplementation(() => { throw new Error("must not read env"); });
    const h = harness((call, count) => success(config(count - 1, { name: "provider-owned" })));
    await expect(h.run({ appConfig: byoConfig })).resolves.toEqual({ id: ids[0], cachedId: ids[1] });
    expect(readPostgresEnv).not.toHaveBeenCalled();
    expect(h.calls.map(({ method, url, body }) => [method, url.pathname.split("/").at(-1), body]))
      .toEqual([["GET", ids[0], undefined], ["GET", ids[1], undefined]]);
  });

  it.each([0, 1])("refuses BYO caching mismatch at config %i without writes", async (index) => {
    const h = harness((call, count) => success(config(count - 1, count - 1 === index ? { caching: { disabled: index !== 0 } } : {})));
    await expect(h.run({ appConfig: byoConfig })).rejects.toThrow(`config ${index === 0 ? "hyperdriveId" : "hyperdriveCachedId"} must have caching ${index === 0 ? "disabled" : "enabled"}`);
    expect(h.calls.map(({ method }) => method)).toEqual(["GET", "GET"]);
  });

  it.each([2013, 2008, 2007])("teaches the production URL repair for origin error %i without credentials", async (code) => {
    const h = harness(({ method }) => method === "GET" ? listed() :
      Response.json({ success: false, errors: [{ code, message: env.url.value }] }, { status: 400 }));
    const error = await h.run().catch((error) => error);
    expect(error.message).toMatch(/\[Goribu\].*app-postgres.*fix POSTGRES_URL in \.env.production/);
    expectPrivate(h, error);
  });

  it("quotes an unrecognized Cloudflare error with credentials redacted", async () => {
    const h = harness(({ method }) => method === "GET" ? listed() :
      Response.json({ success: false, errors: [{ code: 2009, message: `database rejected ${env.url.value}` }] }, { status: 400 }));
    const error = await h.run().catch((error) => error);
    expect(error.message).toMatch(/\[Goribu\].*Hyperdrive config app-postgres.*Cloudflare said: 2009 "database rejected .*<redacted>.*Fix what Cloudflare reports/);
    expectPrivate(h, error);
  });

  it.each([{ host: "db-pooler.example.test" }, { port: 6543 }, { port: 6432 }])("warns and continues for pooler hint %j", async (settings) => {
    env.url.value = connection(settings);
    const h = managedServer();
    await h.run();
    expect(h.output()).toContain("[Goribu] Warning: POSTGRES_URL in .env.production appears to use a pooler. Switch to your provider's direct connection string; Hyperdrive already pools connections.\n");
    expect(h.calls.map(({ method }) => method)).toEqual(["GET", "POST", "POST"]);
    expectPrivate(h);
  });

  it("maps sslmode=require to mtls on create and PATCH and ignores other query parameters", async () => {
    env.url.value = connection({ parameters: "?sslmode=require&channel_binding=require" });
    const h = managedServer();
    await h.run();
    await h.run();
    for (const { body } of h.calls.filter(({ method }) => method !== "GET")) {
      expect(body.mtls).toEqual({ sslmode: "require" });
      expect(Object.keys(body.origin).sort()).toEqual(["database", "host", "password", "port", "scheme", "user"]);
    }
  });

  it.each(["verify-full", "verify-ca", "disable", "", "require&sslmode=verify-full"])("refuses unsupported sslmode %s before any API call", async (sslmode) => {
    env.url.value = connection({ parameters: `?sslmode=${sslmode}` });
    const h = managedServer();
    await expect(h.run()).rejects.toThrow(/\[Goribu\].*app-postgres.*CA upload.*hyperdriveId and hyperdriveCachedId/);
    expect(h.calls.length).toBe(0);
  });

  it.each([401, 403, 400])("gives permission guidance on auth failure HTTP %i", async (status) => {
    const h = harness(() => Response.json({ success: false, errors: [{ code: 10000 }] }, { status }));
    await expect(h.run()).rejects.toThrow(/\[Goribu\].*app-postgres.*permission.*cloudflare-login.*CLOUDFLARE_API_TOKEN/);
    expect(h.calls.length).toBe(1);
  });

  it("does not retry a transient create failure and teaches safe exact-name lookup on rerun", async () => {
    const h = harness(({ method }) => method === "GET" ? listed() :
      Response.json({ success: false, errors: [{ code: 10000 }] }, { status: 500 }));
    await expect(h.run()).rejects.toThrow(/\[Goribu\].*app-postgres.*HTTP 500.*Rerunning.*safe.*exact config names/);
    expect(h.calls.map(({ method }) => method)).toEqual(["GET", "POST"]);
  });

  it("handles duplicate-name races and missing BYO IDs without retrying or creating replacements", async () => {
    for (const [code, configToUse, repair] of [[2017, appConfig, /duplicate name/], [2006, byoConfig, /could not find.*hyperdriveId/]]) {
      const h = harness(({ method }) => method === "GET" && code === 2017 ? listed() :
        Response.json({ success: false, errors: [{ code }] }, { status: code === 2006 ? 404 : 400 }));
      await expect(h.run({ appConfig: configToUse })).rejects.toThrow(repair);
      expect(h.calls.map(({ method }) => method)).toEqual(code === 2006 ? ["GET"] : ["GET", "POST"]);
    }
  });

  it("fails closed on invalid list metadata, unreadable responses, and missing BYO caching", async () => {
    for (const response of [success([]), listed([], -1), listed([config(0, { id: "" })]), listed([config(0)], 0), success(null), new Response("invalid JSON")]) {
      const h = harness(() => response);
      await expect(h.run()).rejects.toThrow(/\[Goribu\].*invalid response.*app-postgres/);
      expect(h.calls.map(({ method }) => method)).toEqual(["GET"]);
    }
    const h = harness((call, count) => success(config(count - 1, { caching: {} })));
    await expect(h.run({ appConfig: byoConfig })).rejects.toThrow(/must have caching disabled/);
    expect(h.calls.map(({ method }) => method)).toEqual(["GET", "GET"]);
  });

  it("discards transport and JSON parsing exceptions that could contain credentials", async () => {
    for (const parseFailure of [false, true]) {
      const h = harness(() => {
        if (parseFailure) return { status: 200, json() { throw new Error(env.url.value); } };
        throw new Error(env.url.value);
      });
      const error = await h.run().catch((error) => error);
      expect(error.message).toMatch(/\[Goribu\].*app-postgres.*Rerunning/);
      expectPrivate(h, error);
      expect(h.calls.length).toBe(1);
    }
  });

  it("checks arguments and skips non-Postgres apps without reading env or calling fetch", async () => {
    const h = managedServer();
    await expect(h.run({ appConfig: { ...appConfig } })).rejects.toThrow(/defineConfig/);
    await expect(h.run({ stdout: {} })).rejects.toThrow(/writable stdout/);
    await expect(h.run({ appConfig: defineConfig(base) })).resolves.toBeNull();
    await expect(h.run({ appConfig: defineConfig({ ...base, database: { type: "d1", name: "app-db" } }) })).resolves.toBeNull();
    expect(readPostgresEnv).not.toHaveBeenCalled();
    expect(h.calls.length).toBe(0);
  });
});
