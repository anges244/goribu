import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createR2 } from "../src/runtime/create-r2.js";
import { presignS3Url } from "../src/r2/sigv4.js";
import { DOWNLOAD_PURPOSE, UPLOAD_PURPOSE, signToken, verifyToken } from "../src/r2/token.js";

// Independent oracle: botocore.auth.S3SigV4QueryAuth with explicit Credentials,
// AWSRequest(method, path-style URL, headers), datetime.utcnow frozen to now.
// No account, credential discovery, or network was used to generate these vectors.
const { vectors } = JSON.parse(readFileSync(new URL("./fixtures/r2-signing-vectors.json", import.meta.url)));
const config = { name: "test-media", domain: "media.example.com", private: { name: "test-private" }, jurisdiction: "eu" };
const secret = "test-only-secret-for-r2-signatures";
const context = { requestUrl: "https://app.example.com/route?query=ignored" };

describe("R2 signing", () => {
  it("matches independent botocore GET, PUT, signed-header and extra-query vectors", async () => {
    for (const { signature, ...args } of vectors) {
      const url = new URL(await presignS3Url({ ...args, now: new Date(args.now) }));
      expect(url.searchParams.get("X-Amz-Signature"), JSON.stringify(args)).toBe(signature);
      if (args.headers) expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("cache-control;content-length;content-type;host;if-none-match");
      if (args.jurisdiction) expect(url.hostname).toBe("abc123.eu.r2.cloudflarestorage.com");
    }
  });

  it("authenticates canonical tokens with distinct purposes, expiry and secret rotation", async () => {
    const payload = { bucket: "private", key: "é /%", exp: 200 };
    const token = await signToken(payload, secret, DOWNLOAD_PURPOSE);
    await expect(verifyToken(token, secret, DOWNLOAD_PURPOSE, 199)).resolves.toEqual(payload);
    for (const [value, key, purpose, now] of [
      [token, secret, DOWNLOAD_PURPOSE, 200], [token, "rotated", DOWNLOAD_PURPOSE, 100],
      [token, secret, UPLOAD_PURPOSE, 100], [token + ".extra", secret, DOWNLOAD_PURPOSE, 100],
      [token + "=", secret, DOWNLOAD_PURPOSE, 100], ["bad.!", secret, DOWNLOAD_PURPOSE, 100],
      ["a".repeat(17000), secret, DOWNLOAD_PURPOSE, 100],
      [token.replace(token[0], token[0] === "A" ? "B" : "A"), secret, DOWNLOAD_PURPOSE, 100],
    ]) await expect(verifyToken(value, key, purpose, now)).resolves.toBeNull();
    for (const payload of [{}, { exp: "200" }, { exp: 200.1 }, [], null]) {
      await expect(verifyToken(await signToken(payload, secret, DOWNLOAD_PURPOSE), secret, DOWNLOAD_PURPOSE, 100)).resolves.toBeNull();
    }
    await expect(signToken({ exp: 200 }, undefined, DOWNLOAD_PURPOSE)).rejects.toThrow(/\[Goribu\].*GORIBU_SECRET/);
  });

  it("selects Worker downloads without keys and always in dev, with no storage resolution", async () => {
    const env = { GORIBU_SECRET: secret, get R2() { throw new Error("storage must stay lazy"); }, get R2_PRIVATE() { throw new Error("storage must stay lazy"); } };
    for (const mode of ["development", "production"]) {
      const r2 = createR2(env, config, mode, context);
      for (const [bucket, api] of [["default", r2], ["private", r2.private]]) {
        const url = new URL(await api.signedUrl("some/key.pdf", { download: "invoice.pdf" }));
        expect(url.origin + url.pathname).toBe("https://app.example.com/_goribu/r2/file");
        const payload = await verifyToken(url.searchParams.get("t"), secret, DOWNLOAD_PURPOSE);
        expect(payload).toMatchObject({ bucket, key: "some/key.pdf", download: "invoice.pdf" });
        expect(payload.exp - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(899);
      }
    }
    const dev = createR2({ GORIBU_SECRET: secret, get R2_ACCESS_KEY_ID() { throw new Error("dev must not inspect credentials"); } }, config, "development", context);
    await expect(dev.signedUrl("key")).resolves.toContain("/_goribu/r2/file?t=");
  });

  it("uses presigned URLs with complete production credentials, including EU and attachment query", async () => {
    const env = { R2_ACCESS_KEY_ID: "test-id", R2_SECRET_ACCESS_KEY: "test-secret", GORIBU_R2_ACCOUNT_ID: "a".repeat(32), get CLOUDFLARE_ACCOUNT_ID() { throw new Error("signer must not use the app-owned account variable"); }, get GORIBU_SECRET() { throw new Error("S3 does not need app secret"); } };
    const r2 = createR2(env, config, "production", context);
    const url = new URL(await r2.private.signedUrl("é a.pdf", { expiresIn: 604800, download: "résumé.pdf" }));
    expect(url.hostname).toBe(`${"a".repeat(32)}.eu.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe("/test-private/%C3%A9%20a.pdf");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("604800");
    expect(url.searchParams.get("response-content-disposition")).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf");
    const defaultUrl = new URL(await createR2(env, { name: "private-files" }, "production", context).signedUrl("key"));
    expect(defaultUrl.hostname).toBe(`${"a".repeat(32)}.r2.cloudflarestorage.com`);
  });

  it("reuses immutable URLs within windows and keeps short links valid on both transports", async () => {
    vi.useFakeTimers();
    try {
      for (const direct of [false, true]) {
        const env = direct
          ? { R2_ACCESS_KEY_ID: "test-id", R2_SECRET_ACCESS_KEY: "test-secret", GORIBU_R2_ACCOUNT_ID: "a".repeat(32) }
          : { GORIBU_SECRET: secret };
        const api = createR2(env, config, "production", context).private;
        for (const expiresIn of [1, 2, 10, 119, 120, 900, 604800]) {
          const window = Math.max(1, Math.floor(expiresIn / 2));
          const start = Math.floor(1800000000 / window) * window;
          vi.setSystemTime(start * 1000);
          const first = await api.signedUrl("image", { expiresIn, immutable: true });
          vi.setSystemTime((start + window - 1) * 1000);
          expect(await api.signedUrl("image", { expiresIn, immutable: true })).toBe(first);
          const url = new URL(first);
          if (direct) {
            expect(url.searchParams.get("response-cache-control")).toBe("private, immutable");
            expect(url.searchParams.get("response-expires")).toBe(new Date((start + expiresIn) * 1000).toUTCString());
            // Both response overrides participate in the canonical signature.
            const args = { method: "GET", accountId: env.GORIBU_R2_ACCOUNT_ID, bucket: config.private.name,
              key: "image", accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY,
              expiresIn, jurisdiction: "eu", now: new Date(start * 1000) };
            for (const removed of ["response-cache-control", "response-expires"]) {
              const queryParams = [...url.searchParams].filter(([name]) => !name.startsWith("X-Amz-") && name !== removed);
              expect(new URL(await presignS3Url({ ...args, queryParams })).searchParams.get("X-Amz-Signature"))
                .not.toBe(url.searchParams.get("X-Amz-Signature"));
            }
          } else {
            const payload = await verifyToken(url.searchParams.get("t"), secret, DOWNLOAD_PURPOSE);
            expect(payload).toMatchObject({ immutable: true, exp: start + expiresIn });
            expect(payload.exp - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(Math.ceil(expiresIn / 2));
          }
          vi.setSystemTime((start + window) * 1000);
          expect(await api.signedUrl("image", { expiresIn, immutable: true })).not.toBe(first);
        }
        vi.setSystemTime(1800000000000);
        const plain = await api.signedUrl("image");
        expect(await api.signedUrl("image", { immutable: false })).toBe(plain);
        vi.setSystemTime(1800000001000);
        expect(await api.signedUrl("image")).not.toBe(plain);
      }
    } finally { vi.useRealTimers(); }
  });

  it("rejects invalid options, partial credentials and prerendering without exposing secret values", async () => {
    const r2 = createR2({ GORIBU_SECRET: secret }, config, "production", context);
    for (const expiresIn of [0, -1, 604801, NaN, Infinity, 1.5, "60"]) await expect(r2.signedUrl("key", { expiresIn })).rejects.toThrow(/expiresIn/);
    for (const immutable of [null, 1, "yes"]) await expect(r2.signedUrl("key", { immutable })).rejects.toThrow(/immutable must be true or false/);
    for (const download of ["", "../file", "bad\r\nheader", "\ud800"]) await expect(r2.signedUrl("key", { download })).rejects.toThrow(/filename/);
    for (const key of ["", "a/../b", "\ud800", "é".repeat(513)]) await expect(r2.signedUrl(key)).rejects.toThrow(/stored object key/);
    await expect(r2.signedUrl("key", { extra: true })).rejects.toThrow(/only expiresIn, download and immutable/);
    await expect(createR2({}, undefined, "production", context).signedUrl("key")).rejects.toThrow(/no R2 bucket/);
    await expect(createR2({ R2_ACCESS_KEY_ID: "never-echo-this" }, config, "production", context).signedUrl("key")).rejects.toThrow(/Configure both Worker secrets/);
    const credentials = { R2_ACCESS_KEY_ID: "fake", R2_SECRET_ACCESS_KEY: "fake" };
    await expect(createR2(credentials, config, "production", context).signedUrl("key")).rejects.toThrow(/GORIBU_R2_ACCOUNT_ID.*goribu deploy/);
    const read = vi.fn(() => { throw new Error("must reject before credentials"); });
    const prerender = createR2({ get R2_ACCESS_KEY_ID() { return read(); } }, config, "production", { ...context, prerender: true });
    await expect(prerender.signedUrl("key")).rejects.toThrow(/cannot run during prerendering.*prerender = false/);
    await expect(prerender.private.signedUrl("key")).rejects.toThrow(/cannot run during prerendering/);
    expect(read).not.toHaveBeenCalled();
  });
});
