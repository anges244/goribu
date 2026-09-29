import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { resolveWranglerBin } from "../src/build/resolve-wrangler-bin.js";

it("Wrangler emits R2 replacement bindings without requesting non-secret retention", async () => {
  const root = mkdtempSync(join(tmpdir(), "goribu-r2-binding-upload-"));
  const env = { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: join(root, "wrangler.log") };
  for (const name of Object.keys(env)) if (/^(CLOUDFLARE_|CF_)/.test(name)) delete env[name];
  try {
    writeFileSync(join(root, "worker.js"), 'export default { fetch() { return new Response("test"); } };');
    // Synthetic secrets only; no app-authored files or Cloudflare account used.
    writeFileSync(join(root, ".env.production"), "UNRELATED_SECRET=synthetic-test-value\n");
    const base = { name: "goribu-r2-binding-upload", main: "worker.js", compatibility_date: "2026-09-01" };
    async function metadata(bindings, withSecretsFile = false) {
      writeFileSync(join(root, "wrangler.json"), JSON.stringify({ ...base, ...bindings }));
      await promisify(execFile)(process.execPath, [resolveWranglerBin(), "deploy", "--dry-run", "--outfile", "upload.bundle",
        ...(withSecretsFile ? ["--secrets-file=.env.production"] : [])], { cwd: root, env, timeout: 30000 });
      const body = readFileSync(join(root, "upload.bundle"));
      const boundary = body.subarray(2, body.indexOf("\r\n")).toString();
      const form = await new Response(body, { headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` } }).formData();
      const part = form.get("metadata");
      return JSON.parse(typeof part === "string" ? part : await part.text());
    }
    const old = await metadata({ vars: { R2: "old-plain-var" } });
    expect(old.bindings).toContainEqual({ name: "R2", type: "plain_text", text: "old-plain-var" });
    for (const withSecretsFile of [false, true]) {
      const replacement = await metadata({ r2_buckets: [{ binding: "R2", bucket_name: "app-files" }] }, withSecretsFile);
      expect(replacement.bindings.filter((binding) => binding.name === "R2")).toEqual([
        { name: "R2", type: "r2_bucket", bucket_name: "app-files" },
      ]);
      // The secrets-file path explicitly preserves other secrets. Without a
      // file the deploy API supplies its default secret preservation behavior.
      expect(replacement.keep_bindings?.toSorted()).toEqual(withSecretsFile ? ["secret_key", "secret_text"] : undefined);
      expect(replacement.bindings.some((binding) => binding.type === "inherit")).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60000);
