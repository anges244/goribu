import { createHttpError } from "./http-error.js";

// Ported from the previous version. Resource facades are prepared by createApp
// so binding resolution and D1 bookmark ownership remain request-scoped.
const textDecoder = new TextDecoder();

/**
 * Wrap a Worker Web Request in Goribu's handler-facing request surface.
 *
 * Route matching supplies params separately because URL parsing cannot recover
 * their names. The application boundary supplies Worker bindings and only the
 * bound waitUntil capability, never the raw execution context. Body helpers share
 * one lazy byte read so neither helper can consume the request stream out from
 * under the other.
 *
 * @param {Request} request
 * @param {Record<string, string>} params
 * @param {{ env?: object, waitUntil?: (promise: Promise<unknown>) => void, cookies?: object, d1?: Function, kv?: object, r2?: object }} [runtime]
 */
export function createRequest(request, params, runtime) {
  assertInputs(request, params);
  const worker = assertRuntime(runtime);

  const url = new URL(request.url);
  const safeParams = copyParams(params);
  let rawBodyPromise;
  let bodyPromise;

  function readRawBodyOnce() {
    if (!rawBodyPromise) {
      rawBodyPromise = readRequestBytes(request);
    }
    return rawBodyPromise;
  }

  return {
    method: request.method,
    path: url.pathname,
    params: safeParams,
    query: url.searchParams,
    headers: request.headers,
    env: worker.env,
    cookies: worker.cookies,
    d1: worker.d1,
    kv: worker.kv,
    r2: worker.r2,
    waitUntil(promise) {
      assertWaitUntilPromise(promise);
      if (typeof worker.waitUntil !== "function") {
        throw new TypeError(
          "[Goribu] req.waitUntil(promise) is unavailable because no Worker execution context was provided. Call the route through createApp().fetch(request, env, ctx) so Goribu can bind ctx.waitUntil.",
        );
      }
      worker.waitUntil(promise);
    },
    rawBody: readRawBodyOnce,
    body() {
      if (!bodyPromise) {
        bodyPromise = readRawBodyOnce().then((bytes) =>
          parseBody(bytes, request.headers.get("content-type")),
        );
      }
      return bodyPromise;
    },
  };
}

function assertInputs(request, params) {
  if (!(request instanceof Request)) {
    throw new TypeError(
      "[Goribu] createRequest(request, params) requires a Web Request as its first argument. " +
        "Pass the Request received by the Worker fetch handler.",
    );
  }

  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new TypeError(
      "[Goribu] createRequest(request, params) requires matched route parameters as an object. " +
        "Pass the params returned by Goribu's route matcher, or {} for a static route.",
    );
  }

  for (const name of Object.keys(params)) {
    if (typeof params[name] !== "string") {
      throw new TypeError(
        `[Goribu] Route parameter "${name}" must be a string. ` +
          "Pass the params returned by Goribu's route matcher without changing their values.",
      );
    }
  }
}

function assertRuntime(runtime) {
  if (runtime === undefined) return {};
  if (runtime === null || typeof runtime !== "object" || Array.isArray(runtime)) {
    throw new TypeError(
      "[Goribu] createRequest(request, params, runtime) requires the request runtime prepared by createApp(). Pass its Worker bindings, bound waitUntil function, cookie jar, and D1/KV/R2 facades.",
    );
  }
  if (
    runtime.env !== undefined &&
    (runtime.env === null || typeof runtime.env !== "object" || Array.isArray(runtime.env))
  ) {
    throw new TypeError(
      "[Goribu] createRequest(request, params, runtime) requires runtime.env to be the Worker bindings object received by fetch.",
    );
  }
  if (runtime.waitUntil !== undefined && typeof runtime.waitUntil !== "function") {
    throw new TypeError(
      "[Goribu] createRequest(request, params, runtime) requires runtime.waitUntil to be the bound ctx.waitUntil function.",
    );
  }
  if (
    runtime.cookies !== undefined &&
    (runtime.cookies === null ||
      typeof runtime.cookies !== "object" ||
      typeof runtime.cookies.get !== "function" ||
      typeof runtime.cookies.set !== "function" ||
      typeof runtime.cookies.delete !== "function" ||
      !Array.isArray(runtime.cookies.pending))
  ) {
    throw new TypeError(
      "[Goribu] createRequest(request, params, runtime) requires runtime.cookies to be the request cookie jar. Pass createCookieJar(request) from the application boundary.",
    );
  }
  if (runtime.d1 !== undefined && typeof runtime.d1 !== "function") {
    throw new TypeError(
      "[Goribu] createRequest(request, params, runtime) requires runtime.d1 to be the request-scoped D1 facade. Pass createD1RequestController(...).d1 from the application boundary.",
    );
  }
  if (
    runtime.kv !== undefined &&
    (runtime.kv === null || typeof runtime.kv !== "object" ||
      ["get", "put", "list", "delete"].some((method) => typeof runtime.kv[method] !== "function"))
  ) {
    throw new TypeError(
      "[Goribu] createRequest requires runtime.kv to be the request-scoped KV facade. Pass createKV(env) from the application boundary.",
    );
  }
  return runtime;
}

function assertWaitUntilPromise(promise) {
  let then;
  try {
    then = promise?.then;
  } catch (cause) {
    throw new TypeError(
      "[Goribu] req.waitUntil(promise) requires a Promise. Pass the asynchronous work returned by the background operation.",
      { cause },
    );
  }

  if (typeof then !== "function") {
    throw new TypeError(
      "[Goribu] req.waitUntil(promise) requires a Promise. Pass the asynchronous work returned by the background operation.",
    );
  }
}

/** Copy through property definitions so `__proto__` remains ordinary data. */
function copyParams(params) {
  const copied = {};

  for (const name of Object.keys(params)) {
    Object.defineProperty(copied, name, {
      configurable: true,
      enumerable: true,
      value: params[name],
      writable: true,
    });
  }

  return copied;
}

async function readRequestBytes(request) {
  if (request.bodyUsed) {
    throw new TypeError(
      "[Goribu] Cannot read the request body because the Web Request body was already consumed. " +
        "Create the Goribu request wrapper before reading the Request body directly.",
    );
  }

  try {
    return new Uint8Array(await request.arrayBuffer());
  } catch (cause) {
    throw new Error(
      "[Goribu] Could not read the Web Request body. " +
        "Pass an unread Request with a valid body stream.",
      { cause },
    );
  }
}

async function parseBody(bytes, contentType) {
  // Empty payloads use the friendly object fallback before media-type parsing.
  // This deliberately means empty text and multipart bodies also resolve to {}.
  if (bytes.byteLength === 0) return {};

  const mediaType = contentType
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();

  if (mediaType === "application/json" || mediaType?.endsWith("+json")) {
    return parseJson(bytes);
  }

  if (mediaType === "application/x-www-form-urlencoded") {
    return parseUrlEncoded(bytes);
  }

  if (mediaType === "multipart/form-data") {
    return parseMultipart(bytes, contentType);
  }

  if (mediaType?.startsWith("text/")) {
    return textDecoder.decode(bytes);
  }

  // The locked friendly fallback for an absent or unsupported Content-Type.
  // Exact bytes remain available through rawBody().
  return {};
}

function parseJson(bytes) {
  let value;

  try {
    value = JSON.parse(textDecoder.decode(bytes));
  } catch (cause) {
    throw createHttpError(
      400,
      "[Goribu] Could not parse the application/json request body. " +
        "Send valid JSON, or use rawBody() when the payload is not JSON.",
      { cause },
    );
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw createHttpError(
      400,
      "[Goribu] The application/json request body must contain a JSON object. " +
        "Wrap top-level arrays or primitive values in an object.",
    );
  }

  return value;
}

function parseUrlEncoded(bytes) {
  return collectFormFields(new URLSearchParams(textDecoder.decode(bytes)));
}

// Both form encodings share one field contract. Defining own properties keeps
// names such as __proto__ ordinary data; repeated entries retain their order.
function collectFormFields(entries) {
  const parsed = {};

  for (const [name, value] of entries) {
    if (Object.hasOwn(parsed, name)) {
      const previous = parsed[name];
      if (Array.isArray(previous)) previous.push(value);
      else parsed[name] = [previous, value];
    } else {
      Object.defineProperty(parsed, name, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
  }

  return parsed;
}

async function parseMultipart(bytes, contentType) {
  if (!/;\s*boundary\s*=\s*(?:"[^"]+"|[^;\s]+)/i.test(contentType)) {
    throw createHttpError(
      400,
      "[Goribu] Could not parse the multipart/form-data request body because its Content-Type " +
        "is missing a boundary. Let the client set Content-Type when sending FormData.",
    );
  }

  try {
    const response = new Response(bytes, {
      headers: { "content-type": contentType },
    });
    return collectFormFields(await response.formData());
  } catch (cause) {
    throw createHttpError(
      400,
      "[Goribu] Could not parse the multipart/form-data request body. " +
        "Check that its boundary and multipart encoding are valid.",
      { cause },
    );
  }
}
