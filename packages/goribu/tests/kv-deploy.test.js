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
    expect(events).toEqual(["guard D1", "guard KV", "build", "provision D1", "provision KV", "finalize KV", "finalize D1", "migrate", "upload"]);
  });

  it("aborts upload on KV failure and avoids schema mutation until bindings are finalized", async () => {
    for (const failure of ["guard KV", "build", "provision KV", "finalize KV"]) {
      const { options } = scenario(failure);
      await expect(runDeploy(options)).rejects.toThrow(`${failure} failed`);
      expect(options.deploy).not.toHaveBeenCalled();
      expect(options.migrate).not.toHaveBeenCalled();
      if (["guard KV", "build"].includes(failure)) {
        expect(options.provision).not.toHaveBeenCalled();
        expect(options.provisionKV).not.toHaveBeenCalled();
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
