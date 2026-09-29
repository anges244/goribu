import { spawn as nodeSpawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { ensureR2SigningSecret, listR2SecretNames } from "../src/build/r2-secrets.js";

it("real Wrangler creates a draft and pipes a generated secret, reuses it, and keeps values out of errors and logs", async () => {
  const root = mkdtempSync(join(tmpdir(), "goribu-r2-secret-api-"));
  const accountId = "a".repeat(32);
  const prefix = `/accounts/${accountId}/workers/scripts/test-app`;
  const calls = [];
  let workerExists = false, secret, rejectPut = false;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    calls.push(`${request.method} ${path}`);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const send = (result) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ success: true, result })); };
    const fail = (code, message = "test failure") => {
      response.statusCode = code === 10007 ? 404 : 403;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ success: false, errors: [{ code, message }] }));
    };
    if (request.method === "GET" && path === `${prefix}/settings`) {
      return workerExists ? send({ bindings: secret ? [{ name: "GORIBU_SECRET", type: "secret_text" }] : [] }) : fail(10007);
    }
    if (request.method === "GET" && path === `${prefix}/secrets`) {
      return workerExists ? send(secret ? [{ name: "GORIBU_SECRET", type: "secret_text" }] : []) : fail(10007);
    }
    if (request.method === "PUT" && path === prefix) { workerExists = true; return send({ id: "test-app" }); }
    if (request.method === "PUT" && path === `${prefix}/secrets`) {
      const input = JSON.parse(body);
      if (!workerExists) return fail(10007);
      secret = input.text;
      if (rejectPut) return fail(10000, `Rejected ${secret}`);
      return send({ name: input.name, type: input.type });
    }
    return fail(10000, `Unexpected test request ${request.method} ${path}`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const appConfig = defineConfig({ name: "test-app", compatibilityDate: "2026-09-01", r2: { name: "app-files" } });
  const spawnCalls = [];
  const spawn = (command, args, options) => {
    spawnCalls.push({ args, options });
    const env = { ...options.env };
    for (const name of Object.keys(env)) if (/^(CLOUDFLARE_|CF_)/.test(name)) delete env[name];
    return nodeSpawn(command, args, { ...options, env: { ...env, CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_API_TOKEN: "test-only-token", CLOUDFLARE_API_BASE_URL: base, WRANGLER_LOG_PATH: join(root, "wrangler.log") } });
  };
  let output = "";
  const options = { projectRoot: root, appConfig, access: { accountId, headers: { Authorization: "Bearer test-only-token" } },
    fetch: (url, init) => fetch(url.replace("https://api.cloudflare.com/client/v4", base), init), spawn, stdout: { write: (text) => { output += text; } } };
  try {
    writeFileSync(join(root, "wrangler.json"), JSON.stringify({ name: "test-app", compatibility_date: "2026-09-01" }));
    writeFileSync(join(root, ".env.production"), "APP_SECRET=synthetic-app-value\n");
    await ensureR2SigningSecret(options);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const generated = secret;
    expect(calls.filter((call) => call === `PUT ${prefix}`)).toHaveLength(1);
    expect(output).toContain("Created Worker secret GORIBU_SECRET");
    expect(output).not.toContain(generated);
    const before = calls.length;
    await ensureR2SigningSecret(options);
    expect(calls.slice(before).every((call) => call.startsWith("GET"))).toBe(true);
    expect(secret).toBe(generated);
    expect(await listR2SecretNames(options)).toEqual(["GORIBU_SECRET"]);
    expect(readFileSync(join(root, ".env.production"), "utf8")).toBe("APP_SECRET=synthetic-app-value\n");
    for (const { args, options: child } of spawnCalls) {
      expect(args).not.toContain(generated);
      expect(child.env.CLOUDFLARE_ACCOUNT_ID).toBe(accountId);
      expect(child.env.WRANGLER_WRITE_LOGS).toBe("false");
      expect(child.env.WRANGLER_LOG_SANITIZE).toBe("true");
    }
    secret = undefined;
    rejectPut = true;
    const error = await ensureR2SigningSecret(options).catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/\[Goribu\] Could not create GORIBU_SECRET/);
    expect(error.message).not.toContain(secret);
    expect(error.cause).toBeUndefined();
    expect(existsSync(join(root, "wrangler.log"))).toBe(false);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
}, 60000);
