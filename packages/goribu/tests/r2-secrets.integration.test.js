import { spawn as nodeSpawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { ensureR2SigningSecret, ensureR2UploadKeys, listR2SecretNames } from "../src/build/r2-secrets.js";

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

it("real Wrangler stores missing upload keys through the terminal and confirms their names", async () => {
  const root = mkdtempSync(join(tmpdir(), "goribu-r2-keys-api-"));
  const accountId = "a".repeat(32);
  const prefix = `/accounts/${accountId}/workers/scripts/test-app`;
  const secrets = new Map([["GORIBU_SECRET", "generated"], ["R2_ACCESS_KEY_ID", "existing-key-id"]]);
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && path === `${prefix}/secrets`) {
      return response.end(JSON.stringify({ success: true, result: [...secrets.keys()].map((name) => ({ name, type: "secret_text" })) }));
    }
    if (request.method === "PUT" && path === `${prefix}/secrets`) {
      const input = JSON.parse(Buffer.concat(chunks).toString());
      secrets.set(input.name, input.text);
      return response.end(JSON.stringify({ success: true, result: { name: input.name, type: input.type } }));
    }
    response.statusCode = 403;
    response.end(JSON.stringify({ success: false, errors: [{ code: 10000, message: `Unexpected ${request.method} ${path}` }] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const asked = [];
  // Stand in for the person at the terminal: Wrangler reads piped stdin
  // the same way it reads its hidden prompt.
  const spawn = (command, args, options) => {
    const env = { ...options.env, CLOUDFLARE_API_TOKEN: "test-only-token", CLOUDFLARE_API_BASE_URL: base };
    if (options.stdio[0] !== "inherit") return nodeSpawn(command, args, { ...options, env });
    asked.push({ args, options });
    const child = nodeSpawn(command, args, { ...options, env, stdio: ["pipe", "ignore", "ignore"] });
    child.stdin.end("typed-secret-access-key\n");
    return child;
  };
  let output = "";
  const options = { projectRoot: root, access: { accountId }, spawn, stdout: { write: (text) => { output += text; } },
    appConfig: defineConfig({ name: "test-app", compatibilityDate: "2026-09-01", r2: { name: "app-files" } }),
    uploads: { cors: [{ bucket: "app-files", jurisdiction: "eu" }] } };
  try {
    writeFileSync(join(root, "wrangler.json"), JSON.stringify({ name: "test-app", compatibility_date: "2026-09-01" }));
    await ensureR2UploadKeys(options);
    expect(secrets.get("R2_SECRET_ACCESS_KEY")).toBe("typed-secret-access-key");
    expect(secrets.get("R2_ACCESS_KEY_ID")).toBe("existing-key-id");
    expect(asked).toHaveLength(1);
    expect(asked[0].args.slice(1)).toEqual(["secret", "put", "R2_SECRET_ACCESS_KEY", "--name", "test-app"]);
    expect(asked[0].options.stdio).toEqual(["inherit", "inherit", "ignore"]);
    expect(asked[0].options.env.CLOUDFLARE_ACCOUNT_ID).toBe(accountId);
    expect(asked[0].options.env.CI).toBe(process.env.CI);
    expect(output).toContain(`https://dash.cloudflare.com/${accountId}/r2/api-tokens`);
    expect(output).toContain("Object Read & Write. Apply it to: app-files (eu).");
    expect(output).toContain("R2_SECRET_ACCESS_KEY: the token's Secret Access Key");
    expect(output).not.toContain("R2_ACCESS_KEY_ID:");
    expect(output).toContain("✓ Stored Worker secrets R2_SECRET_ACCESS_KEY");
    expect(output).not.toContain("typed-secret-access-key");

    // Both names already exist: nothing is asked.
    asked.length = 0;
    await ensureR2UploadKeys(options);
    expect(asked).toHaveLength(0);

    // A cancelled prompt leaves the name missing, so deploy must stop.
    secrets.delete("R2_ACCESS_KEY_ID");
    const cancelled = await ensureR2UploadKeys({ ...options, spawn: (command, args, child) =>
      child.stdio[0] === "inherit" ? nodeSpawn(process.execPath, ["-e", "process.exit(1)"]) : spawn(command, args, child) }).catch((error) => error);
    expect(cancelled.message).toMatch(/\[Goribu\] Could not store R2_ACCESS_KEY_ID with Wrangler\. If you cancelled the prompt, rerun `goribu deploy`/);
    expect(secrets.has("R2_ACCESS_KEY_ID")).toBe(false);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
}, 60000);
