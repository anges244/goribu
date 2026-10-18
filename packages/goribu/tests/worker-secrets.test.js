import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { listWorkerSecretNames } from "../src/build/worker-secrets.js";

const options = { projectRoot: "/app", appConfig: { name: "app" },
  access: { accountId: "a".repeat(32), headers: { Authorization: "Bearer test-token" } },
  resolveBin: () => "/wrangler.js", allowMissingWorker: true };

function spawnResult(code, output = "[]") {
  return vi.fn(() => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    queueMicrotask(() => {
      child.stdout.emit("data", output);
      child.emit("close", code, null);
    });
    return child;
  });
}

it("reads only Worker secret names through Wrangler without issuing a deletion or existence probe on success", async () => {
  const spawn = spawnResult(0, JSON.stringify([{ name: "POSTGRES_URL" }, { name: "POSTGRES_URL" }, { name: "OTHER" }]));
  const fetch = vi.fn();
  await expect(listWorkerSecretNames({ ...options, spawn, fetch })).resolves.toEqual(["POSTGRES_URL", "OTHER"]);
  expect(spawn.mock.calls[0][1]).toEqual(["/wrangler.js", "secret", "list", "--format", "json", "--name", "app"]);
  expect(spawn.mock.calls[0][2].env.CLOUDFLARE_ACCOUNT_ID).toBe(options.access.accountId);
  expect(fetch).not.toHaveBeenCalled();
});

it("treats only a confirmed missing Worker as an empty secret list on first deploy", async () => {
  const spawn = spawnResult(1);
  const fetch = vi.fn(async () => Response.json({ success: false, errors: [{ code: 10007 }] }, { status: 404 }));
  await expect(listWorkerSecretNames({ ...options, spawn, fetch })).resolves.toEqual([]);
  expect(fetch).toHaveBeenCalledWith(
    `https://api.cloudflare.com/client/v4/accounts/${options.access.accountId}/workers/scripts/app/settings`,
    { method: "GET", headers: options.access.headers, redirect: "error" },
  );
  expect(spawn.mock.calls.length).toBe(1);
});

it("does not hide permission, network, parsing, or unrelated not-found failures as a missing Worker", async () => {
  const responses = [
    () => Response.json({ success: false, errors: [{ code: 10000 }] }, { status: 403 }),
    () => Response.json({ success: false, errors: [{ code: 10007 }] }, { status: 403 }),
    () => Response.json({ success: false, errors: [{ code: 10000 }] }, { status: 404 }),
    () => Response.json({ success: false, errors: [{ code: 10007 }, { code: 10000 }] }, { status: 404 }),
    () => Response.json({ success: true, result: { bindings: [] } }),
    () => new Response("untrusted diagnostic", { status: 404 }),
    () => { throw new Error("untrusted diagnostic"); },
  ];
  for (const fetch of responses) {
    const error = await listWorkerSecretNames({ ...options, spawn: spawnResult(1), fetch }).catch((error) => error);
    expect(error.message).toMatch(/^\[Goribu\] Could not read secret names with Wrangler/);
    expect(error.message).not.toContain("untrusted diagnostic");
    expect(error.cause).toBeUndefined();
  }
  const fetch = vi.fn();
  await expect(listWorkerSecretNames({ ...options, spawn: spawnResult(0, "invalid JSON"), fetch })).rejects.toThrow(/Could not read secret names/);
  expect(fetch).not.toHaveBeenCalled();
  await expect(listWorkerSecretNames({ ...options, allowMissingWorker: false, spawn: spawnResult(1), fetch })).rejects.toThrow(/Could not read secret names/);
  expect(fetch).not.toHaveBeenCalled();
});
