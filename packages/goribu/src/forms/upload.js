const MESSAGES = {
  type: "This file type isn't allowed.",
  size: "This file is too large.",
  forbidden: "You don't have permission to upload here.",
  network: "The upload failed. Try again.",
  expired: "The upload took too long. Try again.",
  server: "Something went wrong. Try again.",
};

export class UploadError extends Error {
  constructor(code, options = {}) {
    let message = MESSAGES[code] ?? MESSAGES.server;
    if (code === "size" && Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0) {
      const bytes = options.maxBytes;
      const [unit, divisor] = bytes >= 1e9 ? ["GB", 1e9] : bytes >= 1e6 ? ["MB", 1e6] : ["KB", 1e3];
      message += ` The limit is ${Number((bytes / divisor).toFixed(3))} ${unit}.`;
    }
    // These messages are rendered to end users; developer diagnostics retain [Goribu].
    super(message, options);
    this.name = "UploadError";
    this.code = Object.hasOwn(MESSAGES, code) ? code : "server";
  }
}

/** Start on the application's action route, then transfer bytes to its signed target. */
export async function upload(file, { action, name, signal } = {}) {
  try {
    signal?.throwIfAborted();
    const current = new URL(globalThis.window.location.href);
    const url = new URL(action, current);
    if (typeof action !== "string" || !action || url.origin !== current.origin ||
        !["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        typeof name !== "string" || !name || !(file instanceof Blob) || typeof file.name !== "string") {
      throw new UploadError("server");
    }
    const response = await fetch(url.href, {
      method: "POST", credentials: "same-origin", redirect: "manual", signal,
      headers: { "content-type": "application/json", "x-goribu-upload": name },
      body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
    });
    if (!response.ok) throw await responseError(response, false, name, url);
    let result;
    try { result = await response.json(); } catch { throw new UploadError("server"); }
    signal?.throwIfAborted();
    const { target, ref } = result ?? {};
    if (typeof ref !== "string" || !ref || target?.method !== "PUT" ||
        typeof target.url !== "string" || !target.url || !target.headers ||
        typeof target.headers !== "object" || Array.isArray(target.headers) ||
        !Object.values(target.headers).every((value) => typeof value === "string")) throw new UploadError("server");
    const destination = new URL(target.url, url);
    if (!["http:", "https:"].includes(destination.protocol) || destination.username || destination.password) throw new UploadError("server");
    // Never attach cookies or allow a redirect to move a signed byte transfer.
    const put = await fetch(destination.href, {
      method: "PUT", headers: target.headers, body: file, signal,
      credentials: "omit", redirect: "error",
    });
    if (!put.ok) throw await responseError(put, true);
    signal?.throwIfAborted();
    return ref;
  } catch (cause) {
    if (cause instanceof UploadError) throw cause;
    throw new UploadError("network", { cause });
  }
}

async function responseError(response, transfer, name, url) {
  let code, maxBytes;
  try { ({ code, maxBytes } = await response.json()); } catch { /* S3 and middleware may not return JSON. */ }
  if (!transfer && code === "field" && import.meta.env?.DEV) {
    console.error(`[Goribu] <FileUpload name=${JSON.stringify(name)}> posts to ${url.pathname}, which has no uploads.${name}. Declare that field on the action route.`);
  }
  if (Object.hasOwn(MESSAGES, code)) return new UploadError(code, { maxBytes });
  if (response.status === 401 || response.status === 403 || response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)) return new UploadError(transfer ? "expired" : "forbidden");
  return new UploadError("server");
}
