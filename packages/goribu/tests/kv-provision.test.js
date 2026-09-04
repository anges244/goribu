import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { runCheck } from "../src/build/run-check.js";
import { listRemoteKVNamespaces } from "../src/build/inspect-kv.js";
import { createCloudflareKVNamespace, provisionKV } from "../src/build/provision-kv.js";

const base = { name: "app", compatibilityDate: "2026-09-04" };
const appConfig = defineConfig({ ...base, kv: { name: "app-kv" } });
const namespace = { title: "app-kv", id: "a".repeat(32) };

describe("KV check and provisioning", () => {
  it("plans missing and existing namespaces alongside D1 without mutation", async () => {
    const both = defineConfig({ ...base, kv: appConfig.kv, database: { type: "d1", name: "app-db" } });
    for (const inventory of [[], [namespace]]) {
      let output = "";
      const plan = await runCheck({
        projectRoot: "/app", loadConfig: async () => both,
        inspectD1: async () => [], inspectKV: async () => inventory,
        stdout: { write(text) { output += text; } },
      });
      expect(plan.resources.map((resource) => resource.kind)).toEqual(["D1 database", "KV namespace"]);
      expect(plan.resources[1].action).toBe(inventory.length ? "none" : "create");
      expect(output).toContain('KV -> KV namespace "app-kv"');
      expect(output).toContain("KV reads, writes, deletes, lists, and storage");
      expect(output).toContain("No changes were made.");
    }
    const inspectD1 = vi.fn();
    const inspectMigrations = vi.fn();
    await runCheck({ projectRoot: "/app", loadConfig: async () => appConfig, inspectKV: async () => [], inspectD1, inspectMigrations, stdout: { write() {} } });
    expect(inspectD1).not.toHaveBeenCalled();
    expect(inspectMigrations).not.toHaveBeenCalled();
  });

  it("creates once, prints only the change, and reuses the existing namespace", async () => {
    const inventory = [];
    const getAccess = vi.fn(async () => ({ accountId: "account", headers: {} }));
    const createNamespace = vi.fn(async () => { inventory.push(namespace); return namespace; });
    let output = "";
    const options = { projectRoot: "/app", appConfig, inspectKV: async () => inventory, getAccess, createNamespace, stdout: { write(text) { output += text; } } };
    await expect(provisionKV(options)).resolves.toEqual(namespace);
    await expect(provisionKV(options)).resolves.toEqual(namespace);
    expect(createNamespace).toHaveBeenCalledOnce();
    expect(getAccess).toHaveBeenCalledOnce();
    expect(output).toBe("✓ Created KV namespace app-kv\n");
  });

  it("rejects ambiguous or invalid inventories and mismatched creation results", async () => {
    const createNamespace = vi.fn();
    for (const inventory of [null, {}, [{ title: "app-kv", id: "" }], [namespace, { ...namespace, id: "b".repeat(32) }]]) {
      await expect(provisionKV({ projectRoot: "/app", appConfig, inspectKV: async () => inventory, createNamespace })).rejects.toThrow(/\[Goribu\]/);
    }
    expect(createNamespace).not.toHaveBeenCalled();
    await expect(provisionKV({ projectRoot: "/app", appConfig, inspectKV: async () => [], getAccess: async () => ({}), createNamespace: async () => ({ ...namespace, title: "wrong" }) })).rejects.toThrow(/different KV namespace/);
    const inspectKV = vi.fn();
    await expect(provisionKV({ projectRoot: "/app", appConfig: defineConfig(base), inspectKV })).resolves.toBeNull();
    await runCheck({ projectRoot: "/app", loadConfig: async () => defineConfig(base), inspectKV, stdout: { write() {} } });
    expect(inspectKV).not.toHaveBeenCalled();
  });

  it("uses Wrangler's JSON namespace list and fails closed on command or JSON failures", async () => {
    function spawnWith({ output = JSON.stringify([namespace]), code = 0, signal = null, error } = {}) {
      return vi.fn(() => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        queueMicrotask(() => {
          if (error) child.emit("error", error);
          else { child.stdout.emit("data", output); child.emit("close", code, signal); }
        });
        return child;
      });
    }
    const spawn = spawnWith();
    await expect(listRemoteKVNamespaces({ projectRoot: "/app", spawn, resolveBin: () => "/wrangler.js" })).resolves.toEqual([namespace]);
    expect(spawn).toHaveBeenCalledWith(process.execPath, ["/wrangler.js", "kv", "namespace", "list"], { cwd: "/app", stdio: ["ignore", "pipe", "inherit"] });
    for (const failure of [{ output: "not json" }, { output: "{}" }, { code: 1 }, { signal: "SIGTERM" }, { error: new Error("spawn failed") }]) {
      await expect(listRemoteKVNamespaces({ projectRoot: "/app", spawn: spawnWith(failure), resolveBin: () => "/wrangler.js" })).rejects.toThrow(/\[Goribu\]/);
    }
  });

  it("creates through the official API without exposing failed response bodies", async () => {
    const access = { accountId: "account", headers: { Authorization: "Bearer private-token" } };
    const fetch = vi.fn(async () => Response.json({ success: true, result: namespace }));
    await expect(createCloudflareKVNamespace({ access, title: namespace.title, fetch })).resolves.toEqual(namespace);
    expect(fetch).toHaveBeenCalledWith("https://api.cloudflare.com/client/v4/accounts/account/storage/kv/namespaces", {
      method: "POST", headers: { ...access.headers, "Content-Type": "application/json" }, body: JSON.stringify({ title: "app-kv" }),
    });
    for (const failedFetch of [async () => Response.json({ success: false, errors: ["private-token"] }, { status: 403 }), async () => new Response("bad json"), async () => { throw new Error("offline"); }]) {
      await expect(createCloudflareKVNamespace({ access, title: namespace.title, fetch: failedFetch })).rejects.toThrow(/\[Goribu\].*goribu check/);
    }
  });
});
