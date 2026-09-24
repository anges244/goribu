import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build, createServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { goribu } from "goribu/vite";

const APPLICATION_CONFIG_URL = new URL(
  "../src/runtime/application-config.js",
  import.meta.url,
).href;
const cleanupDirectories = [];
const developmentServers = [];

const publicBaseValue = "PUBLIC_BASE_VALUE_MUST_BE_REPLACED";
const publicProductionValue = "PUBLIC_PRODUCTION_VALUE_MUST_SURVIVE";
const publicDevelopmentValue = "PUBLIC_DEVELOPMENT_VALUE_MUST_SURVIVE";
const privateValue = "PRIVATE_SERVER_VALUE_MUST_NOT_LEAK";
const legacyViteValue = "LEGACY_VITE_VALUE_MUST_NOT_LEAK";

afterEach(async () => {
  await Promise.all(developmentServers.splice(0).map((server) => server.close()));
  for (const directory of cleanupDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("PUBLIC_* browser environment", () => {
  it("exposes only PUBLIC_* values with Vite's mode precedence", async () => {
    const projectRoot = createProject();
    writeProjectFile(
      projectRoot,
      ".env",
      [
        `PUBLIC_BROWSER_VALUE=${publicBaseValue}`,
        `PRIVATE_SERVER_VALUE=${privateValue}`,
        `VITE_LEGACY_VALUE=${legacyViteValue}`,
        "",
      ].join("\n"),
    );
    writeProjectFile(
      projectRoot,
      ".env.production",
      `PUBLIC_BROWSER_VALUE=${publicProductionValue}\n`,
    );

    const source = await buildClientSource(projectRoot);

    expect(source).toContain("PUBLIC_BROWSER_VALUE");
    expect(source).toContain(publicProductionValue);
    expect(source).not.toContain(publicBaseValue);
    expect(source).not.toContain("PRIVATE_SERVER_VALUE");
    expect(source).not.toContain(privateValue);
    expect(source).not.toContain("VITE_LEGACY_VALUE");
    expect(source).not.toContain(legacyViteValue);
  }, 15_000);

  it("uses the same boundary and mode precedence in development", async () => {
    const projectRoot = createProject();
    writeProjectFile(
      projectRoot,
      ".env",
      [
        `PUBLIC_BROWSER_VALUE=${publicBaseValue}`,
        `PRIVATE_SERVER_VALUE=${privateValue}`,
        `VITE_LEGACY_VALUE=${legacyViteValue}`,
        "",
      ].join("\n"),
    );
    writeProjectFile(
      projectRoot,
      ".env.development",
      `PUBLIC_BROWSER_VALUE=${publicDevelopmentValue}\n`,
    );

    const server = await createServer({
      appType: "custom",
      configFile: false,
      root: projectRoot,
      mode: "development",
      logLevel: "silent",
      plugins: [goribuPlugin()],
      server: { middlewareMode: true },
    });
    developmentServers.push(server);
    const source = (await server.transformRequest("/src/setup/client-entry.js"))?.code;

    expect(source).toContain(publicDevelopmentValue);
    expect(source).not.toContain(publicBaseValue);
    expect(source).not.toContain(privateValue);
    expect(source).not.toContain(legacyViteValue);
  });

  it("accepts Vite's canonical array envPrefix form", async () => {
    const projectRoot = createProject();

    await expect(
      buildClientSource(projectRoot, { envPrefix: ["PUBLIC_"] }),
    ).resolves.toContain("__GORIBU_PUBLIC_ENV__");
  });

  it("rejects user config or later plugins that broaden envPrefix", async () => {
    const projectRoot = createProject();

    await expect(
      buildClientSource(projectRoot, {
        envPrefix: ["PUBLIC_", "VITE_"],
      }),
    ).rejects.toThrow(
      /\[Goribu\].*must use only Vite's "PUBLIC_" envPrefix.*Remove the custom envPrefix.*Keep secrets unprefixed/s,
    );

    await expect(
      buildClientSource(projectRoot, {
        plugins: [
          goribu(),
          {
            name: "unsafe-environment-prefix",
            config() {
              return { envPrefix: "VITE_" };
            },
          },
        ],
      }),
    ).rejects.toThrow(
      /\[Goribu\].*must use only Vite's "PUBLIC_" envPrefix.*received "VITE_"/s,
    );
  });
});

function goribuPlugin() {
  return goribu().find((plugin) => plugin?.name === "goribu");
}

function createProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), "goribu-public-env-"));
  cleanupDirectories.push(projectRoot);
  writeProjectFile(
    projectRoot,
    "src/setup/client-entry.js",
    "globalThis.__GORIBU_PUBLIC_ENV__ = import.meta.env;\n",
  );
  writeProjectFile(
    projectRoot,
    "src/routes/index.js",
    "export default function Page() { return null; }\n",
  );
  writeProjectFile(
    projectRoot,
    "goribu.config.js",
    `import { defineConfig } from ${JSON.stringify(APPLICATION_CONFIG_URL)};\n` +
      'export default defineConfig({ name: "test-app", compatibilityDate: "2026-08-31" });\n',
  );
  return projectRoot;
}

async function buildClientSource(projectRoot, overrides = {}) {
  const result = await build({
    configFile: false,
    root: projectRoot,
    mode: "production",
    logLevel: "silent",
    ...overrides,
    plugins: overrides.plugins ?? [goribu()],
    build: {
      minify: false,
      write: false,
      rollupOptions: {
        input: join(projectRoot, "src/setup/client-entry.js"),
        preserveEntrySignatures: "strict",
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  return outputs
    .flatMap((output) => output.output)
    .filter((entry) => entry.type === "chunk")
    .map((chunk) => chunk.code)
    .join("\n");
}

function writeProjectFile(projectRoot, relativePath, source) {
  const filePath = join(projectRoot, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);
}
