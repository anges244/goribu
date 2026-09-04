const GET_OPTIONS = new Set(["type", "cacheTtl", "metadata"]);
const PUT_OPTIONS = new Set(["expiration", "expirationTtl", "metadata"]);
const LIST_OPTIONS = new Set(["prefix", "limit", "cursor"]);
const BINDING_METHODS = ["get", "getWithMetadata", "put", "list", "delete"];

/** One request's four-method KV surface; resolve env.KV only on first use. */
export function createKV(env) {
  if (env === null || typeof env !== "object" || Array.isArray(env)) {
    throw new TypeError(
      "[Goribu] createKV(env) requires one request's Worker bindings. Pass env from the Worker fetch handler.",
    );
  }
  let binding;
  let resolved = false;
  function resolveBinding() {
    if (!resolved) {
      binding = env.KV;
      if (binding === undefined || binding === null) {
        const fail = () => {
          throw new Error(
            "[Goribu] req.kv was used but no KV binding was found. Expected env.KV. " +
            'Add kv: { name: "your-app-kv" } to goribu.config.js; Goribu synthesizes the binding for dev and deploy. ' +
            "If already declared, restart `goribu dev` or rerun `goribu deploy` to refresh the binding.",
          );
        };
        binding = Object.freeze(Object.fromEntries(BINDING_METHODS.map((method) => [method, fail])));
      } else if (BINDING_METHODS.some((method) => typeof binding[method] !== "function")) {
        throw new TypeError(
          "[Goribu] env.KV is not a Workers KV namespace binding. Pass the Worker env unchanged to app.fetch; in tests provide the native get, getWithMetadata, put, list, and delete methods.",
        );
      }
      resolved = true;
    }
    return binding;
  }

  return Object.freeze({
    async get(key, options) {
      assertKey(key);
      const { metadata, ...nativeOptions } = readOptions("get", options, GET_OPTIONS);
      if (metadata !== undefined && typeof metadata !== "boolean") {
        throw new TypeError("[Goribu] req.kv.get metadata must be true or false. Use get(key, { metadata: true }) to read the value with its metadata.");
      }
      const namespace = resolveBinding();
      return metadata === true
        ? namespace.getWithMetadata(key, nativeOptions)
        : namespace.get(key, nativeOptions);
    },
    async put(key, value, options) {
      assertKey(key);
      const nativeOptions = readOptions("put", options, PUT_OPTIONS);
      return resolveBinding().put(key, value, nativeOptions);
    },
    async list(options) {
      const nativeOptions = readOptions("list", options, LIST_OPTIONS);
      return resolveBinding().list(nativeOptions);
    },
    async delete(key) {
      assertKey(key);
      return resolveBinding().delete(key);
    },
  });
}

function assertKey(key) {
  if (typeof key !== "string" || key.length === 0) {
    throw new TypeError("[Goribu] req.kv requires one non-empty string key. Pass a single key to get, put, or delete.");
  }
}

function readOptions(method, options, allowed) {
  if (options === undefined) return {};
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`[Goribu] req.kv.${method} options must be an object. Use { ${[...allowed].join(", ")} } or omit the options.`);
  }
  const snapshot = { ...options };
  for (const name of Reflect.ownKeys(snapshot)) {
    if (!allowed.has(name)) {
      throw new TypeError(`[Goribu] req.kv.${method} has unsupported option ${String(name)}. Use only ${[...allowed].join(", ")}.`);
    }
  }
  return snapshot;
}
