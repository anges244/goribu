import { DOWNLOAD_PURPOSE, signToken } from "./token.js";
import { presignS3Url } from "./sigv4.js";
import { signedUrlPrerenderError } from "./prerender-error.js";
import { requireR2SigningCredentials } from "./signing-credentials.js";

export function validDownloadKey(key) {
  return typeof key === "string" && key.length > 0 && new TextEncoder().encode(key).length <= 1024 &&
    !key.split("/").some((segment) => segment === "." || segment === "..") && key.isWellFormed();
}

export function validDownloadName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 255 &&
    !/[\x00-\x1f\x7f/\\]/.test(name) && name.isWellFormed();
}

export function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function signedDownloadUrl({ env, config, bucket, mode, requestUrl, prerender, key, options = {} }) {
  if (prerender) throw signedUrlPrerenderError();
  if (!validDownloadKey(key)) throw new TypeError("[Goribu] req.r2.signedUrl(key) requires a non-empty, valid Unicode R2 key of at most 1024 UTF-8 bytes, without . or .. path segments. Pass the stored object key.");
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((key) => key !== "expiresIn" && key !== "download" && key !== "immutable")) {
    throw new TypeError("[Goribu] req.r2.signedUrl options support only expiresIn, download and immutable. Pass an options object with those fields.");
  }
  const { expiresIn = 900, download, immutable = false } = options;
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 604800) throw new TypeError("[Goribu] req.r2.signedUrl expiresIn must be an integer from 1 to 604800 seconds.");
  if (download !== undefined && !validDownloadName(download)) throw new TypeError("[Goribu] req.r2.signedUrl download must be a filename of 1 to 255 characters without slashes or control characters. Pass just the download filename.");

  if (typeof immutable !== "boolean") throw new TypeError("[Goribu] req.r2.signedUrl immutable must be true or false. Use true only for fixed object contents that may be cached privately until link expiry.");
  const now = Math.floor(Date.now() / 1000);
  // Reuse a signature within half-lifetime windows, including short lifetimes.
  const window = Math.max(1, Math.floor(expiresIn / 2));
  const issuedAt = immutable ? now - now % window : now;
  const exp = issuedAt + expiresIn;

  if (mode === "production") {
    if (env.R2_ACCESS_KEY_ID !== undefined || env.R2_SECRET_ACCESS_KEY !== undefined) {
      const { accountId, accessKeyId, secretAccessKey } = requireR2SigningCredentials(env, "presigned downloads");
      return presignS3Url({ method: "GET", accountId, bucket: bucket === "private" ? config.private.name : config.name,
        key, accessKeyId, secretAccessKey, expiresIn, jurisdiction: config.jurisdiction,
        ...(immutable ? { now: new Date(issuedAt * 1000) } : {}),
        queryParams: [
          ...(immutable ? [["response-cache-control", "private, immutable"], ["response-expires", new Date(exp * 1000).toUTCString()]] : []),
          ...(download === undefined ? [] : [["response-content-disposition", contentDisposition(download)]]),
        ] });
    }
  }
  const token = await signToken({ bucket, key, exp, ...(immutable ? { immutable: true } : {}), ...(download === undefined ? {} : { download }) }, env.GORIBU_SECRET, DOWNLOAD_PURPOSE);
  const url = new URL("/_goribu/r2/file", requestUrl);
  url.searchParams.set("t", token);
  return url.href;
}
