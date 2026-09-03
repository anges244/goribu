const TOP_LEVEL_KEYS = new Set([
  "title",
  "description",
  "canonical",
  "robots",
  "meta",
  "links",
]);
const META_DESCRIPTOR_KEYS = new Set(["name", "property", "content"]);
const LINK_KEYS = [
  "rel",
  "href",
  "as",
  "type",
  "media",
  "sizes",
  "hrefLang",
  "crossOrigin",
  "referrerPolicy",
  "fetchPriority",
  "imageSrcSet",
  "imageSizes",
  "color",
];
const LINK_KEY_SET = new Set(LINK_KEYS);
const EVENT_LIKE_KEY = /^on/i;

/** The shared normalized value for a route with no metadata export. */
export const EMPTY_ROUTE_META = Object.freeze({});

/**
 * Validate, copy, and deeply freeze one synchronous route metadata value.
 *
 * @param {unknown} value
 * @param {{ source: string }} options
 * @returns {Readonly<object>}
 */
export function normalizeRouteMeta(value, { source } = {}) {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError(
      "[Goribu] normalizeRouteMeta(value, { source }) requires a non-empty source description. Pass the route identity so invalid metadata points to the export that needs repair.",
    );
  }

  if (value === undefined) return EMPTY_ROUTE_META;
  assertNotThenable(value, source);

  if (!isPlainObject(value)) {
    throw new TypeError(
      `[Goribu] ${source} must be a plain metadata object or be omitted. Export an object containing only title, description, canonical, robots, meta, and links.`,
    );
  }

  assertAllowedKeys(value, TOP_LEVEL_KEYS, source, "top-level");

  const normalized = {};
  copySemanticString(value, normalized, "title", source);
  copySemanticString(value, normalized, "description", source);
  copySemanticString(value, normalized, "canonical", source);
  copySemanticString(value, normalized, "robots", source);

  if (Object.hasOwn(value, "meta")) {
    if (!Array.isArray(value.meta)) {
      throw new TypeError(
        `[Goribu] ${source}.meta must be an array of { name, content } or { property, content } descriptors. Wrap each metadata descriptor in the array.`,
      );
    }
    normalized.meta = Object.freeze(
      value.meta.map((descriptor, index) =>
        normalizeMetaDescriptor(descriptor, index, source),
      ),
    );
  }

  if (Object.hasOwn(value, "links")) {
    if (!Array.isArray(value.links)) {
      throw new TypeError(
        `[Goribu] ${source}.links must be an array of link descriptors. Supply each link as an object with string rel and href fields.`,
      );
    }
    normalized.links = Object.freeze(
      value.links.map((link, index) => normalizeLink(link, index, source)),
    );
  }

  assertNoSemanticDuplicates(normalized, source);

  return Reflect.ownKeys(normalized).length === 0
    ? EMPTY_ROUTE_META
    : Object.freeze(normalized);
}

/**
 * Resolve a route's object or synchronous function metadata export.
 *
 * @param {{ meta: unknown, props: object, url: URL|string, routeId: string }} options
 * @returns {Readonly<object>}
 */
export function resolveRouteMeta(options) {
  const routeId = options?.routeId;
  const props = options?.props;
  const url = options?.url;
  const meta = options?.meta;

  if (typeof routeId !== "string" || routeId.length === 0) {
    throw new TypeError(
      "[Goribu] resolveRouteMeta({ meta, props, url, routeId }) requires a non-empty canonical route ID. Pass the matched route ID without deriving it from the URL.",
    );
  }
  if (!isPlainObject(props)) {
    throw new TypeError(
      `[Goribu] Cannot resolve metadata for route ${JSON.stringify(routeId)} because props is not a plain object. Pass the exact props object that will be rendered for the route.`,
    );
  }

  const resolvedUrl = copyUrl(url, routeId);
  let value = meta;

  if (typeof meta === "function") {
    try {
      value = meta({ props, url: resolvedUrl });
    } catch (cause) {
      throw new Error(
        `[Goribu] Could not resolve metadata for route ${JSON.stringify(routeId)} because its metadata function threw. Fix the function so it returns a metadata object synchronously, or remove the export.`,
        { cause },
      );
    }
  }

  return normalizeRouteMeta(value, {
    source: `Route metadata for ${JSON.stringify(routeId)}`,
  });
}

function normalizeMetaDescriptor(descriptor, index, source) {
  const location = `${source}.meta[${index}]`;
  if (!isPlainObject(descriptor)) {
    throw new TypeError(
      `[Goribu] ${location} must be a plain { name, content } or { property, content } object. Replace it with one exact descriptor shape.`,
    );
  }

  assertAllowedKeys(descriptor, META_DESCRIPTOR_KEYS, location, "descriptor");

  const hasName = Object.hasOwn(descriptor, "name");
  const hasProperty = Object.hasOwn(descriptor, "property");
  const hasContent = Object.hasOwn(descriptor, "content");
  if (hasName === hasProperty || !hasContent) {
    throw new TypeError(
      `[Goribu] ${location} must have exactly { name, content } or { property, content }. Include content and choose one metadata key without adding the other.`,
    );
  }

  const normalized = {};
  if (hasName) {
    assertSemanticString(descriptor.name, `${location}.name`);
    normalized.name = descriptor.name;
  } else {
    assertSemanticString(descriptor.property, `${location}.property`);
    normalized.property = descriptor.property;
  }
  assertSemanticString(descriptor.content, `${location}.content`);
  normalized.content = descriptor.content;
  return Object.freeze(normalized);
}

function normalizeLink(link, index, source) {
  const location = `${source}.links[${index}]`;
  if (!isPlainObject(link)) {
    throw new TypeError(
      `[Goribu] ${location} must be a plain link descriptor with string rel and href fields. Replace it with a data-only object.`,
    );
  }

  assertAllowedKeys(link, LINK_KEY_SET, location, "link descriptor");

  if (!Object.hasOwn(link, "rel") || !Object.hasOwn(link, "href")) {
    throw new TypeError(
      `[Goribu] ${location} requires both rel and href. Add both string fields so the link relationship and destination are explicit.`,
    );
  }

  const normalized = {};
  for (const key of LINK_KEYS) {
    if (!Object.hasOwn(link, key)) continue;
    assertSemanticString(link[key], `${location}.${key}`);
    normalized[key] = link[key];
  }
  return Object.freeze(normalized);
}

function assertNoSemanticDuplicates(metadata, source) {
  for (const [index, descriptor] of (metadata.meta ?? []).entries()) {
    if (!Object.hasOwn(descriptor, "name")) continue;
    const name = descriptor.name.toLowerCase();
    if (name === "description" || name === "robots") {
      throw canonicalRepresentationError(
        `${source}.meta[${index}]`,
        name,
        `name=${JSON.stringify(descriptor.name)}`,
      );
    }
  }

  for (const [index, link] of (metadata.links ?? []).entries()) {
    const relTokens = link.rel.toLowerCase().split(/[\t\n\f\r ]+/);
    if (relTokens.includes("canonical")) {
      throw canonicalRepresentationError(
        `${source}.links[${index}]`,
        "canonical",
        `rel=${JSON.stringify(link.rel)}`,
      );
    }
  }
}

function canonicalRepresentationError(location, field, descriptor) {
  return new TypeError(
    `[Goribu] ${location} uses ${descriptor}, but ${field} has one canonical representation. Move its value to the top-level ${field} field and remove this descriptor.`,
  );
}

function copySemanticString(input, output, key, source) {
  if (!Object.hasOwn(input, key)) return;
  assertSemanticString(input[key], `${source}.${key}`);
  output[key] = input[key];
}

function assertSemanticString(value, location) {
  if (typeof value !== "string") {
    throw new TypeError(
      `[Goribu] ${location} must be a string. Convert the metadata value to text or remove the field.`,
    );
  }
}

function assertAllowedKeys(value, allowedKeys, source, kind) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "string" && allowedKeys.has(key)) continue;

    const displayedKey =
      typeof key === "symbol" ? key.toString() : JSON.stringify(key);
    if (typeof key === "string" && EVENT_LIKE_KEY.test(key)) {
      throw new TypeError(
        `[Goribu] ${source} contains unsafe event-like key ${displayedKey}. Route metadata accepts data only; remove event handlers and event attributes.`,
      );
    }

    throw new TypeError(
      `[Goribu] ${source} contains unknown ${kind} key ${displayedKey}. Remove it and use only the documented route metadata keys.`,
    );
  }
}

function assertNotThenable(value, source) {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return;
  }

  let then;
  try {
    then = value.then;
  } catch (cause) {
    throw new TypeError(
      `[Goribu] ${source} could not be checked for asynchronous behavior because reading its then property threw. Return a plain metadata object without a then property.`,
      { cause },
    );
  }

  if (typeof then === "function") {
    throw new TypeError(
      `[Goribu] ${source} must resolve synchronously and cannot be a Promise or thenable. Return the metadata object directly instead of using async work.`,
    );
  }
}

function copyUrl(value, routeId) {
  if (!(value instanceof URL) && typeof value !== "string") {
    throw new TypeError(
      `[Goribu] Cannot resolve metadata for route ${JSON.stringify(routeId)} because url is not a URL or URL string. Pass the matched request URL.`,
    );
  }

  try {
    return new URL(value instanceof URL ? value.href : value);
  } catch (cause) {
    throw new TypeError(
      `[Goribu] Cannot resolve metadata for route ${JSON.stringify(routeId)} because url is invalid. Pass an absolute URL string or a valid URL object.`,
      { cause },
    );
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
