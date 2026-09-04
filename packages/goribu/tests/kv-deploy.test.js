import { describe, expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { runDeploy } from "../src/build/run-deploy.js";

const appConfig = defineConfig({
  name: "app", compatibilityDate: "2026-09-04",
  kv: { name: "app-kv" }, database: { type: "d1", name: "app-db" },
});
function scenario(failure) {
  const events = [];
  const stage = (name, result) => vi.fn(() => {
    events.push(name);
    if (name === failure) throw new Error(`${name} failed`);
    return result;
  });
  return {
    events,
    options: {
      projectRoot: "/app", loadConfig: async () => appConfig,
      guard: stage("guard D1"), guardKV: stage("guard KV"), build: stage("build"),
      getAccess: stage("auth", { accountId: "account", headers: {} }),
      provision: stage("provision D1", { name: "app-db", uuid: "db-id" }),
      provisionKV: stage("provision KV", { title: "app-kv", id: "a".repeat(32) }),
      finalize: stage("finalize D1"), finalizeKV: stage("finalize KV"),
      migrate: stage("migrate"), deploy: stage("upload", 0),
    },
  };
}
describe("deploy with D1 and KV", () => {
  it("builds before provisioning both resources and attaches both before migrations and upload", async () => {
    const { options, events } = scenario();
    await expect(runDeploy(options)).resolves.toBe(0);
    expect(events).toEqual(["guard D1", "guard KV", "auth", "build", "provision D1", "provision KV", "finalize KV", "finalize D1", "migrate", "upload"]);
    const d1Access = await options.provision.mock.calls[0][0].getAccess();
    const kvAccess = await options.provisionKV.mock.calls[0][0].getAccess();
    expect(d1Access).toBe(options.getAccess.mock.results[0].value);
    expect(kvAccess).toBe(d1Access);
    expect(options.getAccess).toHaveBeenCalledOnce();
  });

  it("aborts upload on KV failure and avoids schema mutation until bindings are finalized", async () => {
    for (const failure of ["guard KV", "auth", "build", "provision KV", "finalize KV"]) {
      const { options } = scenario(failure);
      await expect(runDeploy(options)).rejects.toThrow(`${failure} failed`);
      expect(options.deploy).not.toHaveBeenCalled();
      expect(options.migrate).not.toHaveBeenCalled();
      if (["guard KV", "auth", "build"].includes(failure)) {
        expect(options.provision).not.toHaveBeenCalled();
        expect(options.provisionKV).not.toHaveBeenCalled();
      }
      if (["guard KV", "auth"].includes(failure)) {
        expect(options.build).not.toHaveBeenCalled();
      }
    }
  });

  it("deploys a KV-only app without running D1 migrations", async () => {
    const { options, events } = scenario();
    options.loadConfig = async () => defineConfig({ name: "app", compatibilityDate: "2026-09-04", kv: { name: "app-kv" } });
    options.provision = async () => null;
    await expect(runDeploy(options)).resolves.toBe(0);
    expect(events).toContain("finalize KV");
    expect(options.migrate).not.toHaveBeenCalled();
    expect(options.finalize).not.toHaveBeenCalled();
  });
});
