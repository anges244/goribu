import { describe, expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import {
  getCloudflareAccess,
  provisionD1,
  requestCloudflareD1,
} from "../src/build/provision-d1.js";

function config(replication) {
  return defineConfig({
    name: "app",
    compatibilityDate: "2026-09-03",
    database: {
      type: "d1",
      name: "app-db",
      ...(replication === undefined ? {} : { replication }),
    },
  });
}

describe("D1 provisioning", () => {
  it("creates a missing database with replication in one API request", async () => {
    const writes = [];
    const requestD1 = vi.fn(async () => ({
      name: "app-db",
      uuid: "database-id",
      readReplication: "auto",
    }));

    const database = await provisionD1({
      projectRoot: "/app",
      appConfig: config(),
      inspectD1: async () => [],
      getAccess: async () => ({ accountId: "account", headers: {} }),
      requestD1,
      stdout: { write: (text) => writes.push(text) },
    });

    expect(database).toEqual({
      name: "app-db",
      uuid: "database-id",
      readReplication: "auto",
    });
    expect(requestD1).toHaveBeenCalledWith({
      access: { accountId: "account", headers: {} },
      method: "POST",
      body: { name: "app-db", read_replication: { mode: "auto" } },
    });
    expect(writes.join("")).toBe(
      "✓ Created database app-db\n✓ Enabled global read replication\n",
    );
  });

  it("leaves an existing database untouched when replication is omitted", async () => {
    const getAccess = vi.fn();
    const requestD1 = vi.fn();
    const writes = [];

    await expect(
      provisionD1({
        projectRoot: "/app",
        appConfig: config(),
        inspectD1: async () => [
          {
            name: "app-db",
            uuid: "database-id",
            readReplication: "disabled",
          },
        ],
        getAccess,
        requestD1,
        stdout: { write: (text) => writes.push(text) },
      }),
    ).resolves.toMatchObject({ uuid: "database-id" });
    expect(getAccess).not.toHaveBeenCalled();
    expect(requestD1).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("reconciles an explicit replication policy and prints only the change", async () => {
    const requestD1 = vi.fn(async ({ method }) => {
      expect(method).toBe("PUT");
      return {
        name: "app-db",
        uuid: "database-id",
        readReplication: "disabled",
      };
    });
    const writes = [];

    await provisionD1({
      projectRoot: "/app",
      appConfig: config(false),
      inspectD1: async () => [
        { name: "app-db", uuid: "database-id", readReplication: "auto" },
      ],
      getAccess: async () => ({ accountId: "account", headers: {} }),
      requestD1,
      stdout: { write: (text) => writes.push(text) },
    });

    expect(requestD1).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        databaseId: "database-id",
        body: { read_replication: { mode: "disabled" } },
      }),
    );
    expect(writes).toEqual(["✓ Disabled global read replication\n"]);
  });

  it("does not report or request an already-satisfied explicit policy", async () => {
    const getAccess = vi.fn();
    const writes = [];
    await provisionD1({
      projectRoot: "/app",
      appConfig: config(true),
      inspectD1: async () => [
        { name: "app-db", uuid: "database-id", readReplication: "auto" },
      ],
      getAccess,
      stdout: { write: (text) => writes.push(text) },
    });

    expect(getAccess).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("fails rather than choosing between duplicate remote databases", async () => {
    await expect(
      provisionD1({
        projectRoot: "/app",
        appConfig: config(),
        inspectD1: async () => [
          { name: "app-db", uuid: "one" },
          { name: "app-db", uuid: "two" },
        ],
      }),
    ).rejects.toThrow(/cannot provision or bind one safely/);
  });
});

describe("Cloudflare D1 access", () => {
  it("uses Wrangler's token and the unambiguous authenticated account", async () => {
    const runJson = vi
      .fn()
      .mockResolvedValueOnce({ type: "oauth", token: "secret" })
      .mockResolvedValueOnce({ accounts: [{ id: "account-id" }] });

    await expect(
      getCloudflareAccess({ projectRoot: "/app", runJson }),
    ).resolves.toEqual({
      accountId: "account-id",
      headers: { Authorization: "Bearer secret" },
    });
    expect(runJson.mock.calls.map(([call]) => call.args)).toEqual([
      ["auth", "token", "--json"],
      ["whoami", "--json"],
    ]);
  });

  it("requires an account choice when Wrangler can access several", async () => {
    const runJson = vi
      .fn()
      .mockResolvedValueOnce({ type: "api_token", token: "secret" })
      .mockResolvedValueOnce({ accounts: [{ id: "one" }, { id: "two" }] });

    await expect(
      getCloudflareAccess({ projectRoot: "/app", runJson, accountId: undefined }),
    ).rejects.toThrow(/more than one Cloudflare account.*CLOUDFLARE_ACCOUNT_ID/);
  });

  it("sends the requested API mutation and fails closed on rejection", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        result: {
          name: "app-db",
          uuid: "database-id",
          read_replication: { mode: "auto" },
        },
      }),
    }));
    const access = {
      accountId: "account-id",
      headers: { Authorization: "Bearer secret" },
    };

    await expect(
      requestCloudflareD1({
        access,
        method: "PUT",
        databaseId: "database/id",
        body: { read_replication: { mode: "auto" } },
        fetch,
      }),
    ).resolves.toEqual({
      name: "app-db",
      uuid: "database-id",
      readReplication: "auto",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/account-id/d1/database/database%2Fid",
      expect.objectContaining({ method: "PUT" }),
    );

    await expect(
      requestCloudflareD1({
        access,
        method: "PUT",
        fetch: async () => ({
          ok: false,
          status: 403,
          json: async () => ({ success: false }),
        }),
      }),
    ).rejects.toThrow(/D1 Write permission/);
  });
});
