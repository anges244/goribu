const CACHE_NAME = "goribu:data:v1";
const DEFAULT_TTL_SECONDS = 60;

/** One request's JSON cache. The named cache stays separate from HTTP responses. */
export function createCache(cachesRef, requestUrl, { prerender = false } = {}) {
  const origin = new URL(requestUrl).origin;
  let cachePromise;

  function resolveCache() {
    if (prerender || cachesRef == null) return null;
    return cachePromise ??= cachesRef.open(CACHE_NAME);
  }

  function cacheRequest(key) {
    if (typeof key !== "string" || !key.startsWith("/")) {
      throw new TypeError('[Goribu] req.cache requires a string key starting with "/". Use a key such as "/polls/42".');
    }
    let encoded;
    try {
      encoded = encodeURIComponent(key);
    } catch (cause) {
      throw new TypeError("[Goribu] req.cache keys must contain valid Unicode. Remove unpaired surrogate characters from the key.", { cause });
    }
    // Encode the whole key so dot segments, fragments, and escapes stay literal.
    return new Request(`${origin}/_goribu/cache/${encoded}`);
  }

  return Object.freeze({
    async get(key) {
      const request = cacheRequest(key);
      try {
        const cache = await resolveCache();
        const response = await cache?.match(request);
        return response ? await response.json() : null;
      } catch (error) {
        warn("get", error);
        return null;
      }
    },
    async set(key, value, options) {
      const request = cacheRequest(key);
      const ttl = readTtl(options);
      const body = serialize(value);
      try {
        const cache = await resolveCache();
        if (!cache) return;
        await cache.put(request, new Response(body, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `max-age=${ttl}`,
          },
        }));
      } catch (error) {
        warn("set", error);
      }
    },
    async delete(...keys) {
      const requests = keys.map(cacheRequest);
      if (requests.length === 0) return;
      let cache;
      try {
        cache = await resolveCache();
      } catch (error) {
        warn("delete", error);
        return;
      }
      if (!cache) return;
      await Promise.all(requests.map(async (request) => {
        try {
          await cache.delete(request);
        } catch (error) {
          warn("delete", error);
        }
      }));
    },
  });
}

function readTtl(options) {
  if (options === undefined) return DEFAULT_TTL_SECONDS;
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("[Goribu] req.cache.set options must be an object. Use { ttl: 60 } or omit the options.");
  }
  const snapshot = { ...options };
  if (Reflect.ownKeys(snapshot).some((name) => name !== "ttl")) {
    throw new TypeError("[Goribu] req.cache.set has an unsupported option. Use only { ttl: seconds }.");
  }
  const ttl = snapshot.ttl === undefined ? DEFAULT_TTL_SECONDS : snapshot.ttl;
  if (!Number.isSafeInteger(ttl) || ttl <= 0) {
    throw new TypeError("[Goribu] req.cache.set ttl must be a positive safe integer in seconds. Use { ttl: 60 } or omit ttl for the 60-second default.");
  }
  return ttl;
}

function serialize(value) {
  let body;
  try {
    body = JSON.stringify(value);
  } catch (cause) {
    throw new TypeError("[Goribu] req.cache.set requires a JSON-serializable value. Remove circular references and convert BigInt values before caching.", { cause });
  }
  if (body === undefined) {
    throw new TypeError("[Goribu] req.cache.set requires a JSON value. Pass an object, array, string, number, boolean, or null instead of undefined, a function, or a symbol.");
  }
  return body;
}

function warn(operation, error) {
  console.warn(`[Goribu] req.cache.${operation} failed; continuing without the cache result. If this persists, check the Cloudflare Cache API error.`, error);
}
