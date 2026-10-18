import { createRequire } from "node:module";
import { readWranglerSchema } from "./resolve-wrangler-bin.js";
import { compileWranglerSchema, formatWranglerSchemaErrors } from "./wrangler-schema.js";

const require = createRequire(import.meta.url);

const WRITTEN = "Goribu writes it from goribu.config.js";
const HANDLERS = "it needs Worker handlers or exported classes, which Goribu does not support yet";
const VITE = "the Vite build and goribu dev own bundling and the dev server; configure Vite in vite.config.js instead";
const PRODUCTION_ONLY = "Goribu deploys one production Worker";

// Each field Goribu owns, with the reason the error gives. The list is explicit
// rather than an allowlist so new Wrangler fields pass through; reserving a field
// that was allowed before is a breaking change.
const RESERVED_FIELDS = new Map([
  ["name", `${WRITTEN}; set name there`],
  ["main", "Goribu generates the Worker entry"],
  ["compatibility_date", `${WRITTEN}; set compatibilityDate there`],
  ["compatibility_flags", `${WRITTEN}; set compatibilityFlags there`],
  ["assets", "Goribu owns Static Assets and their routing"],
  ["workers_dev", `${WRITTEN}; set workersDev there`],
  ["preview_urls", `${PRODUCTION_ONLY} and keeps preview URLs off`],
  ["account_id", "Goribu selects the Cloudflare account; set CLOUDFLARE_ACCOUNT_ID to choose one"],
  ["d1_databases", "Goribu manages the D1 binding; declare database: { type: \"d1\" } in goribu.config.js"],
  ["kv_namespaces", "Goribu manages the KV binding; declare kv in goribu.config.js"],
  ["r2_buckets", "Goribu manages the R2 bindings; declare r2 in goribu.config.js"],
  ["hyperdrive", "Goribu manages the Hyperdrive bindings; declare database: { type: \"postgres\" } in goribu.config.js"],
  ["routes", "Goribu attaches the app domain; set domain in goribu.config.js"],
  ["route", "Goribu attaches the app domain; set domain in goribu.config.js"],
  ["env", `${PRODUCTION_ONLY}, so Wrangler environments are not supported`],
  ["previews", `${PRODUCTION_ONLY}, so preview configuration is not supported`],
  ["compliance_region", "Goribu provisions resources through Cloudflare's standard API, which a compliance region would bypass"],
  ["pages_build_output_dir", "Goribu deploys a Worker, not a Pages project"],
  ["dev", VITE],
  ["alias", "Vite resolves modules; use resolve.alias in vite.config.js"],
  ["define", "Vite replaces constants; use define in vite.config.js"],
  ["minify", "Vite minifies the build; use build.minify in vite.config.js"],
  ["base_dir", VITE],
  ["build", VITE],
  ["find_additional_modules", VITE],
  ["no_bundle", VITE],
  ["preserve_file_names", VITE],
  ["rules", VITE],
  ["site", VITE],
  ["tsconfig", VITE],
  ["triggers", HANDLERS],
  ["migrations", HANDLERS],
  ["exports", HANDLERS],
  ["containers", HANDLERS],
  ["cloudchamber", HANDLERS],
  ["placement", "Worker placement is not supported yet; it will be a top-level option in goribu.config.js"],
  ["unsafe", "unsafe fields bypass Wrangler's validation, so Goribu cannot keep its guarantees"],
  ["unsafe_hello_world", "unsafe fields bypass Wrangler's validation, so Goribu cannot keep its guarantees"],
]);

// Framework binding names, reserved whether or not their feature is enabled, so
// turning a feature on never breaks an app.
const RESERVED_NAMES = new Set(["ASSETS", "DB", "KV", "R2", "R2_PRIVATE", "POSTGRES", "POSTGRES_CACHED"]);
const RESERVED_PREFIXES = ["GORIBU_", "__GORIBU_"];

// Binding types Wrangler 4.127.1 always runs remotely, from its local-support
// table; any binding marked remote: true also runs remotely.
const ALWAYS_REMOTE = new Set([
  "ai", "ai_search", "ai_search_namespace", "media", "artifacts", "flagship", "vpc_service", "vpc_network", "websearch", "agent_memory",
]);

let compiled;

/**
 * Check the app's wrangler block against the synthesized config it was merged
 * into, before the file is written: Goribu's reserved fields first, so an owned
 * field reports why Goribu owns it; then Wrangler's schema for unknown fields
 * across the whole config; then reserved binding names.
 */
export function assertWranglerPassthrough({ appConfig, config }) {
  const passthrough = appConfig.wrangler;
  for (const field of Object.keys(passthrough)) {
    const reason = RESERVED_FIELDS.get(field);
    if (reason !== undefined) {
      throw new Error(`[Goribu] wrangler.${field} cannot be set in goribu.config.js: ${reason}. Remove it from the wrangler block.`);
    }
  }
  assertNoReservedNestedFields(passthrough, appConfig.name);

  compiled ??= (() => {
    const { version, schema } = readWranglerSchema();
    return { version, validate: compileWranglerSchema(schema, version) };
  })();
  const errors = compiled.validate(config);
  const owned = errors.find((error) => !Object.hasOwn(passthrough, error.path[0] ?? error.key));
  if (owned !== undefined) {
    throw new Error(`[Goribu] Goribu generated a Wrangler config that Wrangler ${compiled.version}'s schema rejects (${formatWranglerSchemaErrors([owned], compiled.version)[0].replace("[Goribu] ", "")}). This is a Goribu bug; please report it.`);
  }
  if (errors.length > 0) throw new Error(formatWranglerSchemaErrors(errors, compiled.version).join("\n"));

  for (const [name, binding] of Object.entries(listBindings(passthrough))) {
    if (RESERVED_NAMES.has(name) || RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      const kind = binding.type === "plain_text" || binding.type === "json" ? "var" : `${binding.type} binding`;
      throw new Error(
        `[Goribu] The wrangler ${kind} name ${JSON.stringify(name)} is reserved for Goribu, whether or not the matching feature is enabled. Rename it in goribu.config.js.`,
      );
    }
  }
}

function assertNoReservedNestedFields(passthrough, appName) {
  if (isObject(passthrough.queues) && Object.hasOwn(passthrough.queues, "consumers")) {
    throw new Error(`[Goribu] wrangler.queues.consumers cannot be set in goribu.config.js: ${HANDLERS}. Keep only queues.producers.`);
  }
  const external = [
    ["durable_objects.bindings", isObject(passthrough.durable_objects) ? passthrough.durable_objects.bindings : undefined, "Durable Object"],
    ["workflows", passthrough.workflows, "Workflow"],
  ];
  for (const [path, entries, label] of external) {
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, index) => {
      if (isObject(entry) && (entry.script_name === undefined || entry.script_name === appName)) {
        throw new Error(
          `[Goribu] wrangler.${path}[${index}] binds a ${label} class from this Worker, which needs exported classes that Goribu does not support yet. ` +
            "Set script_name to the other Worker that defines the class.",
        );
      }
    });
  }
}

/**
 * Run Wrangler's own reader on the written file for what the schema cannot
 * express, such as duplicate binding names. Wrangler prints its warnings again
 * when Vite reads the same file, so they are hidden here.
 */
export function assertWranglerAccepts(configFile) {
  try {
    require("wrangler").unstable_readConfig({ config: configFile }, { hideWarnings: true });
  } catch (cause) {
    throw new Error(
      `[Goribu] Wrangler rejected the config generated from the wrangler block in goribu.config.js:\n${cause.message}\nFix the wrangler block in goribu.config.js.`,
      { cause },
    );
  }
}

/** Every passed-through binding, by name, with Wrangler's binding type. */
export function listBindings(passthrough) {
  return passthrough === undefined ? {} : require("wrangler").unstable_convertConfigBindingsToStartWorkerBindings(passthrough);
}

/** Names of passed-through bindings that run on Cloudflare even in goribu dev. */
export function listRemoteBindings(passthrough) {
  return Object.entries(listBindings(passthrough))
    .filter(([, binding]) => ALWAYS_REMOTE.has(binding.type) || binding.remote === true)
    .map(([name]) => name);
}

/**
 * The fields and bindings the prerender harness runs without: everything the
 * wrangler block adds except vars, so builds stay credential-free and never
 * reach production resources. The deploy config keeps all of them.
 */
export function listPrerenderWithheld(passthrough) {
  if (passthrough === undefined) return { fields: [], bindings: [] };
  const fields = Object.keys(passthrough).filter((field) => field !== "vars");
  const withoutVars = Object.fromEntries(fields.map((field) => [field, passthrough[field]]));
  return { fields, bindings: Object.keys(listBindings(withoutVars)) };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
