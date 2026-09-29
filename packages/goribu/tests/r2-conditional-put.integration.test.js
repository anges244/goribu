import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestHarness } from "wrangler";
import { expect, it } from "vitest";

it("atomically refuses an existing key, including concurrent conditional puts (S2)", async () => {
  const root = mkdtempSync(join(tmpdir(), "goribu-r2-only-if-"));
  let harness;
  try {
    writeFileSync(join(root, "wrangler.json"), JSON.stringify({ name: "r2-only-if", main: "worker.js", compatibility_date: "2026-09-01", r2_buckets: [{ binding: "R2", bucket_name: "test-only" }] }));
    writeFileSync(join(root, "worker.js"), `export default { async fetch(request, env) {
      const key = crypto.randomUUID();
      const options = { onlyIf: { etagDoesNotMatch: "*" } };
      const results = await Promise.all([env.R2.put(key, "first", options), env.R2.put(key, "second", options)]);
      const winner = results.findIndex(Boolean);
      const before = await env.R2.get(key);
      const retry = await env.R2.put(key, "replacement", options);
      return Response.json({ winner, successes: results.filter(Boolean).length, retry,
        before: await before.text(), after: await (await env.R2.get(key)).text() });
    } };`);
    harness = createTestHarness({ workers: [{ configPath: join(root, "wrangler.json") }] });
    const { url } = await harness.listen();
    const result = await (await fetch(url)).json();
    expect(result).toEqual({ winner: result.winner, successes: 1, retry: null,
      before: ["first", "second"][result.winner], after: ["first", "second"][result.winner] });
  } finally {
    await harness?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
