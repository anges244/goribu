import { signedDownloadUrl } from "../r2/download.js";

const NATIVE_METHODS = ["head", "get", "put", "delete", "list", "createMultipartUpload", "resumeMultipartUpload"];

/** One request's R2 surface. Constructing it and deriving URLs never reads env. */
export function createR2(env, config, mode = "production", context = {}) {
  const signedUrl = (bucket, key, options) => signedDownloadUrl({ env, config, bucket, mode,
    requestUrl: context.requestUrl, prerender: context.prerender, key, options });
  const primary = createBucket(env, config, "R2", "req.r2");
  let privateBucket;
  return Object.freeze({
    ...primary,
    async signedUrl(key, options) {
      assertConfigured(config, "req.r2");
      return signedUrl("default", key, options);
    },
    url(key) {
      assertConfigured(config, "req.r2");
      if (!config.domain) {
        throw new Error(
          "[Goribu] req.r2.url() needs a public bucket. Add r2.domain, or use await req.r2.signedUrl(key) for private files.",
        );
      }
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError("[Goribu] req.r2.url(key) requires a non-empty object key. Pass the key used to store the object.");
      }
      const segments = key.split("/");
      if (segments.some((segment) => segment === "." || segment === "..")) {
        throw new TypeError("[Goribu] req.r2.url(key) cannot represent a key with . or .. path segments because browsers normalize them. Store the object under a key without these segments before deriving its URL.");
      }
      let path;
      try {
        path = segments.map(encodeURIComponent).join("/");
      } catch (cause) {
        throw new TypeError("[Goribu] req.r2.url(key) requires a key with valid Unicode. Replace unpaired surrogate characters before storing the object and deriving its URL.", { cause });
      }
      return mode === "development"
        ? `/_goribu/r2/public/${path}`
        : `https://${config.domain}/${path}`;
    },
    get private() {
      assertConfigured(config?.private, "req.r2.private");
      return privateBucket ??= Object.freeze({
        ...createBucket(env, config.private, "R2_PRIVATE", "req.r2.private"),
        signedUrl: (key, options) => signedUrl("private", key, options),
      });
    },
  });
}

function createBucket(env, config, name, label) {
  let resolved = false;
  let binding;
  let error;
  function resolveBinding() {
    assertConfigured(config, label);
    if (!resolved) {
      binding = env[name];
      if (binding === undefined || binding === null) {
        error = new Error(
          `[Goribu] ${label} is configured but its bucket binding is missing. Expected env.${name}. Pass the Worker env unchanged to app.fetch; restart goribu dev or rerun goribu deploy to refresh the generated binding.`,
        );
      } else if (NATIVE_METHODS.some((method) => typeof binding[method] !== "function")) {
        error = new TypeError(
          `[Goribu] env.${name} is not a Workers R2 bucket binding. Pass the Worker env unchanged to app.fetch; in tests provide the native R2 methods, including createMultipartUpload and resumeMultipartUpload.`,
        );
      }
      resolved = true;
    }
    if (error) throw error;
    return binding;
  }

  const bucket = Object.fromEntries(NATIVE_METHODS.map((method) => [method, (...args) => {
    try {
      const native = resolveBinding();
      if (method === "put" && args[1] instanceof Blob && args[1].type) {
        args[2] = withContentType(args[2], args[1].type);
      }
      return native[method](...args);
    } catch (error) {
      if (method === "resumeMultipartUpload") throw error;
      return Promise.reject(error);
    }
  }]));
  return bucket;
}

function withContentType(options, type) {
  // Leave invalid native dictionaries to the platform rather than repairing them.
  if (options !== undefined && (options === null || typeof options !== "object")) return options;
  const metadata = options?.httpMetadata;
  if (metadata instanceof Headers) {
    if (metadata.has("content-type")) return options;
    const headers = new Headers(metadata);
    headers.set("content-type", type);
    return { ...options, httpMetadata: headers };
  }
  if (metadata !== undefined && (metadata === null || typeof metadata !== "object")) return options;
  if (metadata?.contentType !== undefined) return options;
  return { ...options, httpMetadata: { ...metadata, contentType: type } };
}

function assertConfigured(config, label) {
  if (config !== undefined) return;
  const secondary = label === "req.r2.private";
  throw new Error(
    `[Goribu] ${label} was used but no ${secondary ? "private " : "R2 "}bucket is configured. ` +
      (secondary
        ? 'Add r2.private: { name: "my-app-files" } with r2.domain on the default bucket in goribu.config.js.'
        : 'Add r2: { name: "my-app-media" } to goribu.config.js.'),
  );
}
