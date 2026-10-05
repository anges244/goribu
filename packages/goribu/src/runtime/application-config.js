import { assertOptionalResponseHeaders } from "./response-headers.js";
import { assertR2Config } from "./r2-config.js";
import { assertHostname } from "./hostname-config.js";

const CONFIG_BRAND = new WeakSet();
const CONFIG_FIELDS = new Set([
  "name",
  "domain",
  "workersDev",
  "compatibilityDate",
  "compatibilityFlags",
  "responseHeaders",
  "database",
  "kv",
  "r2",
]);
const D1_DATABASE_FIELDS = new Set(["type", "name", "replication"]);

// Cloudflare Worker script name: lowercase letters, digits, and hyphens, not
// starting or ending with a hyphen, up to 63 characters.
const APP_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const COMPATIBILITY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATABASE_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]{0,62}$/;

/**
 * Validate and brand Goribu's one author-owned application configuration object.
 *
 * The returned value is a frozen snapshot. The config carries only Node-loadable
 * data: the deploy fields Wrangler synthesis needs today, and runtime data fields
 * (responseHeaders, database, kv, r2) added to this same validator as later blocks land
 * their consumers. Render modules never live here — a `Document` field is rejected
 * with a pointer to `src/setup/_document.jsx` (see docs/decisions.md).
 */
export function defineConfig(config) {
  if (CONFIG_BRAND.has(config)) return config;

  if (
    config === null ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    Object.getPrototypeOf(config) !== Object.prototype
  ) {
    throw new TypeError(
      "[Goribu] defineConfig(config) requires a plain application configuration object. Pass defineConfig({ name, compatibilityDate }) from goribu.config.js.",
    );
  }

  if (Object.getOwnPropertySymbols(config).length > 0) {
    throw new TypeError(
      "[Goribu] Application configuration cannot contain symbol-keyed fields. Use only the documented name, domain, workersDev, compatibilityDate, compatibilityFlags, responseHeaders, database, kv, and r2 fields.",
    );
  }

  const descriptors = Object.getOwnPropertyDescriptors(config);
  const normalized = {};
  for (const [field, descriptor] of Object.entries(descriptors)) {
    // Config is Node-loadable data, so a render module can never live on it. The
    // Document is part of the render graph and belongs in a file Vite compiles.
    if (field === "Document") {
      throw new TypeError(
        "[Goribu] Document belongs in src/setup/_document.jsx, not goribu.config.js. " +
          "Move your Document component there. goribu.config.js holds only Node-loadable data (no JSX, no React, no application modules).",
      );
    }
    if (!CONFIG_FIELDS.has(field)) {
      throw new TypeError(
        `[Goribu] Application configuration contains unknown field ${JSON.stringify(field)}. Remove it; the supported fields are name, domain, workersDev, compatibilityDate, compatibilityFlags, responseHeaders, database, kv, and r2.`,
      );
    }
    if (!("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError(
        `[Goribu] Application configuration field ${JSON.stringify(field)} must be an ordinary enumerable value. Replace getters, setters, or hidden properties with a direct value inside defineConfig({ ... }).`,
      );
    }
    normalized[field] = descriptor.value;
  }

  if (typeof normalized.name !== "string" || !APP_NAME_PATTERN.test(normalized.name)) {
    throw new TypeError(
      "[Goribu] Application configuration field name must be a Cloudflare Worker name: lowercase letters, digits, and hyphens, not starting or ending with a hyphen, up to 63 characters. Set name in goribu.config.js.",
    );
  }

  if (
    typeof normalized.compatibilityDate !== "string" ||
    !isRealCalendarDate(normalized.compatibilityDate)
  ) {
    throw new TypeError(
      '[Goribu] Application configuration field compatibilityDate must be a real calendar date in "YYYY-MM-DD" form. Set the Workers compatibility date in goribu.config.js.',
    );
  }

  normalized.compatibilityFlags = assertCompatibilityFlags(normalized.compatibilityFlags);
  if (normalized.domain !== undefined) {
    normalized.domain = assertHostname(normalized.domain, "domain", "app.example.com");
    for (const managedHost of ["workers.dev", "r2.dev"]) {
      if (normalized.domain === managedHost || normalized.domain.endsWith(`.${managedHost}`)) {
        throw new TypeError(
          `[Goribu] Application configuration field domain cannot use Cloudflare-managed ${managedHost} hosts. Set domain to your custom hostname, such as "app.example.com", or omit it to keep the default workers.dev address.`,
        );
      }
    }
  }
  if (normalized.workersDev === undefined) normalized.workersDev = true;
  if (typeof normalized.workersDev !== "boolean") {
    throw new TypeError(
      "[Goribu] Application configuration field workersDev must be true, false, or omitted. Omit it to keep the default workers.dev address, or set workersDev: false to serve the app only from domain.",
    );
  }
  // Without workers.dev and a configured domain, a deploy leaves the app with no address.
  if (!normalized.workersDev && normalized.domain === undefined) {
    throw new TypeError(
      '[Goribu] Application configuration field workersDev: false requires domain. Set domain to your custom hostname, such as "app.example.com", or remove workersDev to keep the workers.dev address.',
    );
  }
  assertOptionalResponseHeaders(
    normalized.responseHeaders,
    "Application configuration field responseHeaders",
  );
  if (normalized.database !== undefined) {
    normalized.database = assertD1DatabaseConfig(normalized.database);
  }
  if (normalized.kv !== undefined) {
    normalized.kv = assertKVConfig(normalized.kv);
  }
  if (normalized.r2 !== undefined) {
    normalized.r2 = assertR2Config(normalized.r2);
    if (normalized.domain !== undefined && normalized.domain === normalized.r2.domain) {
      throw new TypeError(
        '[Goribu] Application configuration field domain must differ from r2.domain. Use separate hostnames for your app and bucket, such as "app.example.com" and "media.example.com".',
      );
    }
  }

  const result = Object.freeze(normalized);
  CONFIG_BRAND.add(result);
  return result;
}

function assertKVConfig(kv) {
  if (
    kv === null || typeof kv !== "object" ||
    Object.getPrototypeOf(kv) !== Object.prototype ||
    Object.getOwnPropertySymbols(kv).length > 0
  ) {
    throw new TypeError(
      '[Goribu] Application configuration field kv must be a plain object containing only name. Set kv: { name: "your-app-kv" } in goribu.config.js.',
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(kv);
  for (const [field, descriptor] of Object.entries(descriptors)) {
    if (field !== "name" || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError(
        `[Goribu] Application configuration field kv.${field} is unsupported or is not an ordinary enumerable value. Use only kv: { name: "your-app-kv" }; Goribu owns the binding and namespace id.`,
      );
    }
  }
  const name = descriptors.name?.value;
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(name)) {
    throw new TypeError(
      "[Goribu] Application configuration field kv.name must start with a lowercase letter or digit and contain only lowercase letters, digits, hyphens, or underscores, up to 63 characters. Rename the namespace in goribu.config.js.",
    );
  }
  return Object.freeze({ name });
}

/** Validate the one D1 declaration this block currently supports. */
function assertD1DatabaseConfig(database) {
  if (
    database === null ||
    typeof database !== "object" ||
    Array.isArray(database) ||
    Object.getPrototypeOf(database) !== Object.prototype
  ) {
    throw new TypeError(
      '[Goribu] Application configuration field database must be a plain object. Pass defineConfig({ database: { type: "d1", name: "your-app-db" } }) in goribu.config.js.',
    );
  }

  if (Object.getOwnPropertySymbols(database).length > 0) {
    throw new TypeError(
      "[Goribu] Application configuration field database cannot contain symbol-keyed fields. Use only type, name, and replication for the D1 declaration.",
    );
  }

  const normalized = {};
  for (const [field, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(database),
  )) {
    if (!D1_DATABASE_FIELDS.has(field)) {
      throw new TypeError(
        `[Goribu] Application configuration field database contains unknown field ${JSON.stringify(field)}. Remove it; the supported D1 fields are type, name, and replication.`,
      );
    }
    if (!("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError(
        `[Goribu] Application configuration field database.${field} must be an ordinary enumerable value. Replace getters, setters, or hidden properties with a direct value.`,
      );
    }
    normalized[field] = descriptor.value;
  }

  if (normalized.type !== "d1") {
    throw new TypeError(
      '[Goribu] Application configuration field database.type must be "d1". Set type: "d1" for the database declared in goribu.config.js.',
    );
  }

  if (
    typeof normalized.name !== "string" ||
    !DATABASE_NAME_PATTERN.test(normalized.name)
  ) {
    throw new TypeError(
      "[Goribu] Application configuration field database.name must be a lowercase D1 database name: start with a letter or digit, then letters, digits, hyphens, or underscores, up to 63 characters. Rename the database in goribu.config.js.",
    );
  }

  if (
    normalized.replication !== undefined &&
    typeof normalized.replication !== "boolean"
  ) {
    throw new TypeError(
      "[Goribu] Application configuration field database.replication must be true, false, or omitted. " +
        "Omit it to enable replication on databases Goribu creates and leave existing ones untouched.",
    );
  }

  return Object.freeze(normalized);
}

/**
 * Report whether a value is a config produced by `defineConfig`.
 *
 * The brand is a private WeakSet, so only values that passed validation here
 * answer true. Build steps use this to fail closed when `goribu.config.js`
 * default-exports something other than a `defineConfig(...)` result.
 */
export function isApplicationConfig(value) {
  return CONFIG_BRAND.has(value);
}

function isRealCalendarDate(value) {
  if (!COMPATIBILITY_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function assertCompatibilityFlags(flags) {
  if (flags === undefined) return Object.freeze([]);

  if (!Array.isArray(flags)) {
    throw new TypeError(
      "[Goribu] Application configuration field compatibilityFlags must be an array of non-empty strings, or omitted. List the Workers compatibility flags your app needs.",
    );
  }

  // Read each element once from its own data descriptor, validate that exact
  // value, then store it. Iterating with the spread/iterable protocol or
  // Array#some could observe different values than the copy keeps -- a sparse
  // hole, a custom Symbol.iterator, or an accessor element -- so the snapshot is
  // built from the same values that were checked.
  const normalized = [];
  for (let index = 0; index < flags.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(flags, index);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new TypeError(
        `[Goribu] Application configuration field compatibilityFlags must be a dense array of non-empty strings; element ${index} is a hole or accessor. Replace it with a plain string value, or omit compatibilityFlags.`,
      );
    }
    const flag = descriptor.value;
    if (typeof flag !== "string" || flag.length === 0) {
      throw new TypeError(
        "[Goribu] Application configuration field compatibilityFlags must be an array of non-empty strings, or omitted. List the Workers compatibility flags your app needs.",
      );
    }
    normalized.push(flag);
  }

  return Object.freeze(normalized);
}
