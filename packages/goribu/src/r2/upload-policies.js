const POLICY_KEYS = new Set(["accept", "maxBytes", "private", "direct", "key"]);
const MIME = /^[a-z0-9!#$&^_.+-]+\/(?:[a-z0-9!#$&^_.+-]+|\*)$/i;

/** Validate once in the Worker, without calling getters or key functions. */
export function collectUploadPolicies(manifest, modules, r2) {
  const policies = new Map();
  const client = new Map();
  const summary = [];
  for (const route of manifest) {
    const module = modules.get(route.id);
    if (!module || !Object.hasOwn(module, "uploads")) continue;
    const source = `Route ${JSON.stringify(route.id)} uploads`;
    if (r2 === undefined) fail(source, "requires R2. Configure r2 in goribu.config.js.");
    if (!route.methods.some((method) => ["POST", "PUT", "PATCH"].includes(method) && typeof module[method] === "function")) {
      fail(source, "requires a POST, PUT or PATCH handler to receive the ref. Export one from this route.");
    }
    const fields = dataProperties(module.uploads, source);
    const normalized = Object.create(null);
    const hints = Object.create(null);
    const metadata = Object.create(null);
    for (const [name, descriptor] of Object.entries(fields)) {
      const field = `${source}.${name}`;
      if (!name) fail(source, "has an empty field name. Use a non-empty upload field name.");
      const properties = dataProperties(descriptor.value, field);
      for (const key of Object.keys(properties)) {
        if (!POLICY_KEYS.has(key)) fail(field, `has unknown option ${JSON.stringify(key)}. Use only accept, maxBytes, private, direct and key.`);
      }
      const value = Object.fromEntries(Object.entries(properties).map(([key, property]) => [key, property.value]));
      const accept = readAccept(value.accept, field);
      if (!Number.isSafeInteger(value.maxBytes) || value.maxBytes <= 0 || value.maxBytes > 5_000_000_000) {
        fail(field, "maxBytes must be a positive integer at most 5,000,000,000. Set the maximum file size in bytes.");
      }
      for (const flag of ["private", "direct"]) {
        if (Object.hasOwn(value, flag) && typeof value[flag] !== "boolean") fail(field, `${flag} must be true or false. Remove it to use the default.`);
      }
      if (value.direct !== true && value.maxBytes > 100_000_000) {
        fail(field, "allows more than the Worker's 100 MB upload limit. Add direct: true or reduce maxBytes to 100,000,000 or less.");
      }
      if (value.private === true && r2.private === undefined) fail(field, "requires a private bucket. Configure r2.private in goribu.config.js or remove private: true.");
      if (Object.hasOwn(value, "key") && typeof value.key !== "function") fail(field, "key must be a function returning an object key. Remove it to use generated keys.");
      hints[name] = Object.freeze({ accept, maxBytes: value.maxBytes });
      metadata[name] = Object.freeze({ ...hints[name], private: value.private === true, direct: value.direct === true });
      normalized[name] = Object.freeze({ ...metadata[name], ...(value.key === undefined ? {} : { key: value.key }) });
    }
    policies.set(route.id, Object.freeze(normalized));
    client.set(route.id, Object.freeze(hints));
    summary.push(Object.freeze({ id: route.id, pattern: route.pattern, fields: Object.freeze(metadata) }));
  }
  return { policies, client, summary: Object.freeze(summary) };
}

function dataProperties(value, source) {
  if (value === null || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail(source, "must be a plain object. Declare upload fields and their options as object literals.");
  }
  const properties = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(properties)) {
    if (typeof key !== "string" || key === "__proto__" || !Object.hasOwn(properties[key], "value")) {
      fail(source, "must use data properties without symbols, __proto__ or getters. Declare ordinary fields and options.");
    }
  }
  return properties;
}

function readAccept(value, source) {
  if (!Array.isArray(value) || value.length === 0) fail(source, "accept must be a non-empty array of MIME types. Use image/* or specific types; */* is not allowed.");
  const properties = Object.getOwnPropertyDescriptors(value);
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = properties[index];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string" || !MIME.test(descriptor.value)) {
      fail(source, "accept must contain MIME types such as image/png or image/*. Parameters, empty entries and */* are not allowed.");
    }
    result.push(descriptor.value.toLowerCase());
  }
  return Object.freeze(result);
}

export class UploadPolicyError extends TypeError {}

function fail(source, message) {
  throw new UploadPolicyError(`[Goribu] ${source} ${message}`);
}
