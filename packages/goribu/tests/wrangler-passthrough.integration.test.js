import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyTestApp } from "./support/copy-test-app.js";

// Real builds of the fixture with a wrangler block naming a remote-only AI
// binding and a service whose Worker does not exist, run with no Cloudflare
// credentials. Unchanged, either binding stops the prerender harness.

const cliPath = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));
const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
const wrangler = {
  ai: { binding: "AI" },
  services: [{ binding: "SEARCH", service: "goribu-test-missing-worker" }],
  vars: { PASSTHROUGH_GREETING: "Hello from the wrangler block" },
};

function page(body, forced = false) {
  return `${forced ? "export const prerender = true;\n" : ""}export default async function Page() {
  let text = "browser";
  if (import.meta.env.SSR) {
    const { env } = await import("cloudflare:workers");
    ${body}
  }
  return <main>{text}</main>;
}
`;
}

let appDir, configHome, build;

function runGoribu(command) {
  // No token, CI to rule out a login prompt, and an empty Wrangler config home.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("CLOUDFLARE_")));
  const result = spawnSync(process.execPath, [cliPath, command], {
    cwd: appDir, encoding: "utf8", timeout: 100000,
    env: { ...env, CI: "true", XDG_CONFIG_HOME: configHome },
  });
  return { status: result.status, error: result.error, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

beforeAll(() => {
  appDir = copyTestApp(fixture, "goribu-passthrough-test-");
  configHome = mkdtempSync(join(tmpdir(), "goribu-passthrough-xdg-"));
  const configFile = join(appDir, "goribu.config.js");
  writeFileSync(configFile, readFileSync(configFile, "utf8").replace("defineConfig({", `defineConfig({\n  wrangler: ${JSON.stringify(wrangler)},`));
  writeFileSync(join(appDir, "src/routes/wrangler-var.jsx"), page("text = env.PASSTHROUGH_GREETING;"));
  writeFileSync(join(appDir, "src/routes/wrangler-ai.jsx"), page('text = String(await env.AI.run("@cf/meta/llama-3.2-1b-instruct", { prompt: "hi" }));'));
  build = runGoribu("build");
}, 120000);

afterAll(() => {
  for (const directory of [appDir, configHome]) if (directory) rmSync(directory, { recursive: true, force: true });
});

describe("goribu build with a wrangler block and no Cloudflare credentials", () => {
  it("prerenders with vars, downgrades a page that needs a withheld binding, and deploys every binding", () => {
    expect(build.error, String(build.error)).toBeUndefined();
    expect(build.status, build.output).toBe(0);

    const clientDir = join(appDir, ".goribu/dist/client");
    expect(readFileSync(join(clientDir, "wrangler-var.html"), "utf8")).toContain("Hello from the wrangler block");
    expect(build.output).toMatch(
      /Route "src\/routes\/wrangler-ai\.jsx" \(\/wrangler-ai\) is a prerender candidate but was not statically output: the Worker responded 500 \(TypeError: Cannot read properties of undefined \(reading 'run'\)\); prerendering runs without the wrangler bindings AI, SEARCH, so a page that uses them must render on the Worker/,
    );

    const deployed = JSON.parse(readFileSync(join(appDir, ".goribu/dist/goribu_basic_app/wrangler.json"), "utf8"));
    expect(deployed.ai).toEqual({ binding: "AI" });
    expect(deployed.services).toEqual(wrangler.services);
    expect(deployed.vars).toMatchObject(wrangler.vars);
    expect(deployed.vars).not.toHaveProperty("__GORIBU_PRERENDER");
  });

  it("fails a forced prerender with the cause and the withheld bindings", () => {
    writeFileSync(join(appDir, "src/routes/wrangler-ai.jsx"), page('text = String(await env.AI.run("@cf/meta/llama-3.2-1b-instruct", { prompt: "hi" }));', true));
    const forced = runGoribu("build");
    expect(forced.status, forced.output).toBe(1);
    expect(forced.output).toContain(
      "[Goribu] Route \"src/routes/wrangler-ai.jsx\" (/wrangler-ai) sets `export const prerender = true`, but the Worker responded 500 (TypeError: Cannot read properties of undefined (reading 'run')); prerendering runs without the wrangler bindings AI, SEARCH",
    );
  }, 120000);
});

it("stops goribu dev before it starts when a remote-only binding has no Cloudflare login", () => {
  const dev = runGoribu("dev");
  expect(dev.status, dev.output).not.toBe(0);
  expect(dev.output).toContain("[Goribu] The wrangler binding AI runs on Cloudflare even in goribu dev, so dev needs Cloudflare access.");
  expect(dev.output).toContain("pnpm exec goribu cloudflare-login");
  expect(dev.output).toContain("CLOUDFLARE_API_TOKEN");
}, 120000);
