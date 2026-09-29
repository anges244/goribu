import { EventEmitter } from "node:events";
import { expect, it } from "vitest";
import { listR2SecretNames } from "../src/build/r2-secrets.js";

const options = { projectRoot: "/app", appConfig: { name: "app" }, access: { accountId: "a".repeat(32) }, resolveBin: () => "/wrangler.js" };
it("secret-name inspection rejects failures and malformed output without disclosing it", async () => {
  for (const result of [
    { output: "untrusted-marker", code: 0 },
    { output: '[{"name":null,"value":"untrusted-marker"}]', code: 0 },
    { output: "[]", code: 1 },
    { output: "[]", code: null, signal: "SIGTERM" },
  ]) {
    const spawn = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      queueMicrotask(() => {
        child.stdout.emit("data", result.output);
        child.emit("close", result.code, result.signal ?? null);
      });
      return child;
    };
    const error = await listR2SecretNames({ ...options, spawn }).catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("[Goribu] Could not read secret names");
    expect(error.message).toContain("pnpm exec goribu cloudflare-login");
    expect(error.message).toContain("CLOUDFLARE_API_TOKEN for non-interactive use");
    expect(error.message).not.toContain("untrusted-marker");
    expect(error.cause).toBeUndefined();
  }
  await expect(listR2SecretNames({ ...options, spawn() { throw new Error("untrusted-marker"); } })).rejects.toThrow(/^\[Goribu\] Could not read secret names/);
});
