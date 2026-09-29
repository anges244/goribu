const R2_FIELDS = new Set(["name", "domain", "private", "jurisdiction"]);
const PRIVATE_FIELDS = new Set(["name"]);
const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/** Snapshot the two managed buckets without evaluating configuration accessors. */
export function assertR2Config(value) {
  const r2 = readFields(value, "r2", R2_FIELDS);
  assertBucketName(r2.name, "r2.name");

  if (r2.domain !== undefined) {
    const domain = r2.domain;
    if (
      typeof domain !== "string" || domain.length > 253 || !domain.includes(".") ||
      !domain.split(".").every((label) => HOST_LABEL.test(label)) ||
      /^[\d.]+$/.test(domain)
    ) {
      throw new TypeError(
        '[Goribu] Application configuration field r2.domain must be a bare hostname with at least two labels, such as "media.example.com", without a scheme, path, port, or IP address. Set r2.domain to your custom hostname.',
      );
    }
    r2.domain = domain.toLowerCase();
    if (r2.domain === "r2.dev" || r2.domain.endsWith(".r2.dev")) {
      throw new TypeError(
        '[Goribu] Application configuration field r2.domain cannot use an r2.dev host. Set r2.domain to your custom hostname, such as "media.example.com".',
      );
    }
  }

  if (r2.private !== undefined) {
    const privateBucket = readFields(r2.private, "r2.private", PRIVATE_FIELDS);
    assertBucketName(privateBucket.name, "r2.private.name");
    if (r2.domain === undefined) {
      throw new TypeError(
        '[Goribu] Application configuration field r2.private requires r2.domain on the default bucket. Add a public domain, or use r2: { name: "your-app-files" } for a single private bucket.',
      );
    }
    if (privateBucket.name === r2.name) {
      throw new TypeError(
        "[Goribu] Application configuration field r2.private.name must differ from r2.name. Give the private bucket its own name so public and private files use separate buckets.",
      );
    }
    r2.private = Object.freeze(privateBucket);
  }

  if (r2.jurisdiction !== undefined && r2.jurisdiction !== "eu") {
    throw new TypeError(
      '[Goribu] Application configuration field r2.jurisdiction must be "eu" or omitted. Use "eu" for both managed buckets in the EU, or omit it for the default jurisdiction.',
    );
  }
  return Object.freeze(r2);
}

function readFields(value, path, allowed) {
  const fields = [...allowed].join(", ");
  if (
    value === null || typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new TypeError(
      `[Goribu] Application configuration field ${path} must be a plain object with only ${fields}. Set ${path} in goribu.config.js using ordinary named fields.`,
    );
  }
  const snapshot = {};
  for (const [field, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!allowed.has(field)) {
      throw new TypeError(
        `[Goribu] Application configuration field ${path}.${field} is unknown. Remove it; the supported fields for ${path} are ${fields}.`,
      );
    }
    if (!("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError(
        `[Goribu] Application configuration field ${path}.${field} must be an ordinary enumerable value. Replace getters, setters, or hidden properties with a direct value.`,
      );
    }
    snapshot[field] = descriptor.value;
  }
  return snapshot;
}

function assertBucketName(name, path) {
  if (typeof name !== "string" || !BUCKET_NAME.test(name)) {
    throw new TypeError(
      `[Goribu] Application configuration field ${path} must contain 3 to 63 lowercase letters, digits, or hyphens and start and end with a letter or digit. Set ${path} to a valid bucket name in goribu.config.js.`,
    );
  }
}
