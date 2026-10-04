import { DOWNLOAD_PURPOSE, verifyToken } from "./token.js";
import { contentDisposition, validDownloadKey, validDownloadName } from "./download.js";

export async function serveR2Download(request, env, r2, config) {
  const empty = (status, extra = {}) => new Response(null, { status, headers: { "cache-control": "private, no-store", ...extra } });
  if (!config) return empty(404);
  if (request.method !== "GET" && request.method !== "HEAD") return empty(405, { allow: "GET, HEAD" });
  const tokens = new URL(request.url).searchParams.getAll("t");
  if (tokens.length !== 1 || !tokens[0]) return empty(403);
  const payload = await verifyToken(tokens[0], env.GORIBU_SECRET, DOWNLOAD_PURPOSE);
  if (!payload || (payload.bucket !== "default" && payload.bucket !== "private") ||
    !validDownloadKey(payload.key) || (payload.download !== undefined && !validDownloadName(payload.download)) ||
    (payload.immutable !== undefined && typeof payload.immutable !== "boolean") ||
    (payload.bucket === "private" && !config.private)) return empty(403);

  const bucket = payload.bucket === "private" ? r2.private : r2;
  const rangeHeaders = new Headers(request.headers);
  const rangeSpec = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeaders.get("range")?.trim() ?? "");
  const hasRange = request.method === "GET" && rangeSpec !== null && (rangeSpec[1] !== "" || rangeSpec[2] !== "");
  if (!hasRange) rangeHeaders.delete("range");
  let object;
  try {
    object = await bucket.get(payload.key, { range: rangeHeaders, onlyIf: request.headers });
  } catch (error) {
    // R2's invalid-range code; other storage failures must stay 500s.
    if (error?.code !== 10039 && !/\(10039\)$/.test(error?.message ?? "")) throw error;
    const metadata = await bucket.head(payload.key);
    return metadata ? empty(416, { "content-range": `bytes */${metadata.size}` }) : empty(404);
  }
  if (object === null) return empty(404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Keep download freshness policy explicit; discard the stored expiry header.
  headers.delete("expires");
  headers.set("cache-control", payload.immutable === true
    ? `private, max-age=${Math.max(0, payload.exp - Math.ceil(Date.now() / 1000))}, immutable`
    : "private, max-age=0");
  headers.set("accept-ranges", "bytes");
  if (payload.download !== undefined) headers.set("content-disposition", contentDisposition(payload.download));
  if (object.body === undefined) {
    // Failed If-Match/If-Unmodified-Since means 412, not cache revalidation.
    const match = request.headers.get("if-match");
    const since = request.headers.get("if-unmodified-since");
    const failedMatch = match !== null && match.trim() !== "*" && !match.split(",").some((etag) => etag.trim() === object.httpEtag);
    const failedDate = match === null && since !== null && Math.floor(object.uploaded.getTime() / 1000) > Math.floor(Date.parse(since) / 1000);
    return new Response(null, { status: failedMatch || failedDate ? 412 : 304, headers });
  }
  if (hasRange && isUnsatisfiableRange(rangeSpec, object.size)) {
    // Header-based ranges may be ignored by R2 when unsatisfiable. Do not turn
    // that full-object fallback into a misleading 206 response.
    await object.body.cancel();
    return empty(416, { "content-range": `bytes */${object.size}` });
  }
  // R2 can report a full-object range even when no Range was requested.
  const range = hasRange ? object.range : undefined;
  const length = range?.length ?? object.size;
  headers.set("content-length", String(length));
  if (range) headers.set("content-range", `bytes ${range.offset}-${range.offset + length - 1}/${object.size}`);
  if (request.method === "HEAD") await object.body.cancel();
  return new Response(request.method === "HEAD" ? null : object.body, { status: range ? 206 : 200, headers });
}

function isUnsatisfiableRange([, start, end], size) {
  if (size === 0) return true;
  if (start === "") return Number(end) === 0;
  return Number(start) >= size || (end !== "" && Number(end) < Number(start));
}
