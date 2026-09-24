import { build } from "vite";
import { expect, it } from "vitest";
import { goribu } from "goribu/vite";

const warning = {
  code: "MODULE_LEVEL_DIRECTIVE",
  id: "/app/node_modules/example/component.mjs",
  message: '\u001b[33m[MODULE_LEVEL_DIRECTIVE]\u001b[0m The semantics of the module level directive "use client" in "node_modules/example/component.mjs" may not be preserved when bundling.',
};

function warningFilter() {
  return goribu().find((plugin) => plugin?.name === "goribu").onLog;
}

it("silences only use-client directive warnings from installed dependencies", () => {
  const onLog = warningFilter();

  for (const id of [
    warning.id,
    "/app/node_modules/.pnpm/example@1.0/node_modules/example/component.mjs",
    "C:\\app\\node_modules\\example\\component.mjs",
  ]) {
    expect(onLog("warn", { ...warning, id })).toBe(false);
  }

  for (const log of [
    { ...warning, id: "/app/src/component.jsx" },
    { ...warning, id: "/app/src/my_node_modules/component.jsx" },
    { ...warning, id: undefined },
    { ...warning, id: "\0virtual:/app/node_modules/example/component.mjs" },
    { ...warning, code: "PLUGIN_WARNING" },
    { ...warning, message: warning.message.replace('"use client"', '"use server"') },
    { ...warning, message: warning.message.replace('"use client"', '"use client-only"') },
    { ...warning, message: "Unknown module directive diagnostic" },
  ]) {
    expect(onLog("warn", log), JSON.stringify(log)).not.toBe(false);
  }

  expect(onLog("info", warning)).not.toBe(false);
  expect(onLog("error", warning)).not.toBe(false);
});

it.each([false, true])("preserves app log handlers and bundle bytes (SSR: %s)", async (ssr) => {
  async function bundle(filtered) {
    const logs = [];
    const warnings = [];

    const result = await build({
      configFile: false,
      logLevel: "warn",
      plugins: [
        ...(filtered ? [{ name: "goribu", onLog: warningFilter() }] : []),
        {
          name: "warning-fixture",
          buildStart() {
            this.warn("Application plugin warning");
          },
          resolveId(id) {
            if (id === "entry") return "\0entry";
            if (id === "dependency") return "/app/node_modules/example/component.mjs";
            if (id === "server-directive") return "/app/node_modules/example/server.mjs";
            if (id === "application") return "/app/src/component.js";
          },
          load(id) {
            if (id === "\0entry") {
              return `
                export { client } from "dependency";
                export { server } from "server-directive";
                export { app } from "application";
              `;
            }
            if (id.endsWith("/component.mjs")) return '"use client"; export const client = "dependency";';
            if (id.endsWith("/server.mjs")) return '"use server"; export const server = "server";';
            if (id.endsWith("/component.js")) return '"use client"; export const app = "application";';
          },
        },
      ],
      build: {
        ssr,
        write: false,
        minify: false,
        rolldownOptions: {
          input: "entry",
          preserveEntrySignatures: "strict",
          onLog(level, log, handler) {
            logs.push(log);
            handler(level, log);
          },
          onwarn(log) {
            warnings.push(log);
          },
        },
      },
    });

    return { result, logs, warnings };
  }

  const before = await bundle(false);
  const after = await bundle(true);

  expect(after.result.output).toEqual(before.result.output);
  expect(after.logs).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "PLUGIN_WARNING", message: "Application plugin warning" }),
  ]));

  // Older supported bundlers do not emit directive diagnostics. When present,
  // the real diagnostic must be the only one removed from both user hooks.
  const remaining = before.logs.filter((log) =>
    log.code !== "MODULE_LEVEL_DIRECTIVE" || log.id !== warning.id,
  );
  expect(after.logs).toHaveLength(remaining.length);
  expect(after.logs).toEqual(expect.arrayContaining(remaining));
  expect(after.warnings).toEqual(after.logs);
});
