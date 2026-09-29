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
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((key) => key !== "expiresIn" && key !== "download")) {
    throw new TypeError("[Goribu] req.r2.signedUrl options support only expiresIn and download. Pass an options object with those fields.");
  }
  const { expiresIn = 900, download } = options;
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 604800) throw new TypeError("[Goribu] req.r2.signedUrl expiresIn must be an integer from 1 to 604800 seconds.");
  if (download !== undefined && !validDownloadName(download)) throw new TypeError("[Goribu] req.r2.signedUrl download must be a filename of 1 to 255 characters without slashes or control characters. Pass just the download filename.");

  if (mode === "production") {
    if (env.R2_ACCESS_KEY_ID !== undefined || env.R2_SECRET_ACCESS_KEY !== undefined) {
      const { accountId, accessKeyId, secretAccessKey } = requireR2SigningCredentials(env, "presigned downloads");
      return presignS3Url({ method: "GET", accountId, bucket: bucket === "private" ? config.private.name : config.name,
        key, accessKeyId, secretAccessKey, expiresIn, jurisdiction: config.jurisdiction,
        queryParams: download === undefined ? [] : [["response-content-disposition", contentDisposition(download)]] });
    }
  }
  const token = await signToken({ bucket, key, exp: Math.floor(Date.now() / 1000) + expiresIn, ...(download === undefined ? {} : { download }) }, env.GORIBU_SECRET, DOWNLOAD_PURPOSE);
  const url = new URL("/_goribu/r2/file", requestUrl);
  url.searchParams.set("t", token);
  return url.href;
}
