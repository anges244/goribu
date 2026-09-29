import { readUploadRef, UPLOAD_METADATA_KEY } from "./upload-ref.js";

/** Reconstruct declared fields; never echo client objects or unverified refs. */
export async function verifyUploads(body, { policies, route, env, r2, config, mode }) {
  if (!body || typeof body !== "object") return body;
  for (const field of Object.keys(policies)) {
    if (!Object.hasOwn(body, field)) continue;
    const submitted = body[field];
    delete body[field];
    const reject = (reason) => {
      if (mode === "development") console.warn(`[Goribu] Upload field ${JSON.stringify(field)} ${reason}`);
    };
    if (typeof submitted !== "string") {
      reject("is declared in uploads; use <FileUpload> or upload() to submit a single signed ref.");
      continue;
    }
    const ref = await readUploadRef(submitted, env, config);
    if (!ref) { reject("has an invalid or expired ref. Upload the file again."); continue; }
    if (ref.route !== route.pattern || ref.field !== field || ref.bucket !== (policies[field].private ? "private" : "default")) {
      reject("has a ref for a different route, field or bucket. Upload through this action's policy.");
      continue;
    }
    const bucket = ref.bucket === "private" ? r2.private : r2;
    // Infrastructure failures must propagate as errors, never as an absent file.
    const object = await bucket.head(ref.key);
    if (!object) { reject("has no stored object. Upload the file again."); continue; }
    // A start can name an existing key even when PUT was skipped or refused.
    // Size/type alone cannot prove this object belongs to this upload.
    if (object.customMetadata?.[UPLOAD_METADATA_KEY] !== ref.uploadId) {
      reject("does not match the stored upload identity. Upload again with a new object key.");
      continue;
    }
    if (object.size !== ref.size || object.httpMetadata?.contentType !== ref.type) {
      await bucket.delete(ref.key);
      reject("failed size or content-type verification and was removed. Upload the file again.");
      continue;
    }
    Object.defineProperty(body, field, { configurable: true, enumerable: true, writable: true,
      value: { key: ref.key, name: ref.name, type: ref.type, size: object.size,
        ...(ref.bucket === "default" && config.domain ? { url: r2.url(ref.key) } : {}) } });
  }
  return body;
}
