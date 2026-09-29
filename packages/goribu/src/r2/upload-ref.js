import { UPLOAD_PURPOSE, verifyToken } from "./token.js";
import { validDownloadKey, validDownloadName } from "./download.js";

export const UPLOAD_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const UPLOAD_METADATA_KEY = "goribu-upload";
const MIME = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

export function acceptsUploadType(type, accept) {
  return typeof type === "string" && MIME.test(type) && accept.some((allowed) =>
    allowed === type || (allowed.endsWith("/*") && type.startsWith(allowed.slice(0, -1))));
}

export function validUploadKey(key) {
  // The same key must survive public and presigned URL path normalization.
  return validDownloadKey(key) && !key.startsWith("/");
}

export function sanitizeUploadName(name) {
  const basename = name.replaceAll("\\", "/").split("/").at(-1);
  return basename.toWellFormed().replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 255).toWellFormed() || "upload";
}

export async function readUploadRef(token, env, config) {
  const ref = await verifyToken(token, env.GORIBU_SECRET, UPLOAD_PURPOSE);
  if (!ref || !config || !["default", "private"].includes(ref.bucket) ||
    typeof ref.uploadId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(ref.uploadId) ||
    (ref.bucket === "private" && !config.private) ||
    typeof ref.route !== "string" || !ref.route.startsWith("/") ||
    typeof ref.field !== "string" || !ref.field || ref.field === "__proto__" ||
    !validUploadKey(ref.key) || !validDownloadName(ref.name) ||
    typeof ref.type !== "string" || !MIME.test(ref.type) ||
    !Number.isSafeInteger(ref.size) || ref.size <= 0 || ref.size > 5_000_000_000 ||
    !Number.isSafeInteger(ref.putExp) || ref.putExp > ref.exp) return null;
  return ref;
}
