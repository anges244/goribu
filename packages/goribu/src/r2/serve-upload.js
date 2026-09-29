import { readUploadRef, UPLOAD_CACHE_CONTROL, UPLOAD_METADATA_KEY } from "./upload-ref.js";

export async function serveR2Upload(request, env, r2, config, mode) {
  const respond = (status, code) => Response.json(code ? { code } : {}, { status, headers: { "cache-control": "no-store" } });
  if (request.method !== "PUT") return new Response(null, { status: 405, headers: { allow: "PUT" } });
  const tokens = new URL(request.url).searchParams.getAll("ref");
  if (tokens.length !== 1) return respond(403, "expired");
  const ref = await readUploadRef(tokens[0], env, config);
  if (!ref || ref.putExp <= Math.floor(Date.now() / 1000)) return respond(403, "expired");
  if (request.headers.get("content-length") !== String(ref.size)) return respond(400, "size");
  if (request.headers.get("content-type") !== ref.type) return respond(400, "type");
  const bucket = ref.bucket === "private" ? r2.private : r2;
  // The Vite dev proxy loses the stream's known length. Production retains the
  // original incoming stream; do not buffer it or race a head() against put().
  const body = mode === "development" ? await request.arrayBuffer() : request.body;
  if (mode === "development" && body.byteLength !== ref.size) return respond(400, "size");
  const object = await bucket.put(ref.key, body, {
    onlyIf: { etagDoesNotMatch: "*" },
    customMetadata: { [UPLOAD_METADATA_KEY]: ref.uploadId },
    httpMetadata: { contentType: ref.type,
      ...(ref.bucket === "default" && config.domain ? { cacheControl: UPLOAD_CACHE_CONTROL } : {}) },
  });
  if (object === null) return respond(409, "exists");
  if (object.size !== ref.size) {
    // This key is authorized by our own signed ref, and this write failed verification.
    await bucket.delete(ref.key);
    return respond(400, "size");
  }
  return respond(200);
}
