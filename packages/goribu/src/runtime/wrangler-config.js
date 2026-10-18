/**
 * Snapshot the `wrangler` field of goribu.config.js as deeply frozen JSON.
 *
 * Goribu writes this block into goribu.wrangler.jsonc, so it must survive
 * JSON.stringify unchanged. Anything JSON would drop or rewrite (undefined,
 * functions, Infinity, Dates, Maps, sparse arrays, cycles) fails here with the
 * path that holds it, rather than silently producing a different config. Each
 * value is read once from its own data descriptor, so getters cannot make the
 * snapshot differ from what was checked.
 */
export function snapshotWranglerConfig(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      "[Goribu] Application configuration field wrangler must be a plain object of Wrangler configuration fields, such as wrangler: { ai: { binding: \"AI\" } }.",
    );
  }
  return copy(value, "wrangler", new Set());
}

function copy(value, path, ancestors) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw unsupported(path, `is ${value}, which JSON cannot represent. Use a finite number`);
  }
  if (typeof value !== "object") {
    throw unsupported(path, `is ${value === undefined ? "undefined" : `a ${typeof value}`}, which JSON cannot represent. Use a string, number, boolean, null, array, or plain object, or remove the field`);
  }
  if (ancestors.has(value)) throw unsupported(path, "refers back to an object that contains it. Remove the circular reference");
  if (Object.getOwnPropertySymbols(value).length > 0) throw unsupported(path, "has symbol-keyed fields. Use only string keys");

  const isArray = Array.isArray(value);
  if (isArray ? Object.getPrototypeOf(value) !== Array.prototype : !isPlainObject(value)) {
    throw unsupported(path, "is not a plain object or array. Replace it with JSON data");
  }

  ancestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  let result;
  if (isArray) {
    // JSON keeps only indices, so a named array property would vanish.
    const named = Object.keys(descriptors).find((key) => key !== "length" && String(Number(key) >>> 0) !== key);
    if (named !== undefined) throw unsupported(`${path}.${named}`, "is a named property on an array, which JSON drops. Move it into an object");
    result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[index];
      if (descriptor === undefined || !("value" in descriptor)) {
        throw unsupported(`${path}[${index}]`, "is a hole or accessor. Replace it with a plain value");
      }
      result.push(copy(descriptor.value, `${path}[${index}]`, ancestors));
    }
  } else {
    result = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!("value" in descriptor) || descriptor.enumerable !== true) {
        throw unsupported(`${path}.${key}`, "must be an ordinary enumerable value. Replace getters, setters, or hidden properties with a direct value");
      }
      result[key] = copy(descriptor.value, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
  return Object.freeze(result);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function unsupported(path, detail) {
  return new TypeError(`[Goribu] Application configuration field ${path} ${detail}.`);
}
