// packages/goribu/src/r2/sigv4.js
//
// AWS SigV4 presigned URL generation for R2's S3-compatible endpoint, shared by
// two callers: `req.r2.signedUrl` (a private GET, for serving) and the upload
// presign endpoint (a PUT, for direct browser-to-R2 upload). Both are the same
// algorithm differing only by HTTP method, so they share one signer — and one
// botocore golden reference vectors keep it honest.
//
// The implementation is path-style (`<account>.r2.cloudflarestorage.com/<bucket>/<key>`),
// region "auto", UNSIGNED-PAYLOAD. Additional headers and query parameters are
// included in the canonical request, with separate golden vectors.

/**
 * Mint a presigned S3 URL for R2.
 *
 * @param {object} args
 * @param {"GET"|"PUT"} args.method
 * @param {string} args.accountId
 * @param {string} args.bucket
 * @param {string} args.key
 * @param {string} args.accessKeyId
 * @param {string} args.secretAccessKey
 * @param {number} args.expiresIn - Seconds (already validated by the caller).
 * @param {Date} [args.now] - Clock injection for deterministic tests.
 * @param {string} [args.region="auto"]
 * @param {"eu"} [args.jurisdiction]
 * @param {HeadersInit} [args.headers] - Additional headers to sign, excluding host.
 * @param {Array<[string, string]>} [args.queryParams] - Non-X-Amz query parameters.
 * @returns {Promise<string>} the signed URL
 */
export async function presignS3Url({
  method,
  accountId,
  bucket,
  key,
  accessKeyId,
  secretAccessKey,
  expiresIn,
  now,
  region = "auto",
  jurisdiction,
  headers = {},
  queryParams = [],
}) {
  const date = now instanceof Date ? now : new Date();
  const amzDate = toAmzDate(date);
  const dateStamp = amzDate.slice(0, 8);
  const service = "s3";
  const host = `${accountId}${jurisdiction === "eu" ? ".eu" : ""}.r2.cloudflarestorage.com`;
  const path = `/${awsEncode(bucket)}/${encodeKeyPath(key)}`;
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const normalizedHeaders = new Headers(headers);
  if (normalizedHeaders.has("host")) throw new Error("[Goribu] The R2 signer owns the host header. Remove it from the supplied signed headers.");
  normalizedHeaders.set("host", host);
  const sortedHeaders = [...normalizedHeaders].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const signedHeaders = sortedHeaders.map(([name]) => name).join(";");
  const canonicalHeaders = sortedHeaders.map(([name, value]) => `${name}:${value.trim().replace(/\s+/g, " ")}\n`).join("");
  if (queryParams.some(([name]) => /^x-amz-/i.test(name))) throw new Error("[Goribu] The R2 signer owns X-Amz query parameters. Remove them from the supplied query parameters.");
  const query = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${accessKeyId}/${credentialScope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresIn)],
    ["X-Amz-SignedHeaders", signedHeaders],
    ...queryParams,
  ];
  const canonicalQuery = canonicalQueryString(query);
  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = await deriveSigningKey(secretAccessKey, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function encodeKeyPath(value) {
  return String(value)
    .split("/")
    .map(awsEncode)
    .join("/");
}

function canonicalQueryString(params) {
  return params
    .map(([key, value]) => [awsEncode(key), awsEncode(value)])
    .sort(([aKey, aValue], [bKey, bValue]) => {
      // Byte-order on the encoded strings, as SigV4 requires (not locale order).
      if (aKey < bKey) return -1;
      if (aKey > bKey) return 1;
      if (aValue < bValue) return -1;
      if (aValue > bValue) return 1;
      return 0;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function awsEncode(value) {
  return encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", utf8(value));
  return hex(new Uint8Array(digest));
}

async function deriveSigningKey(secret, dateStamp, region, service) {
  const kDate = await hmacBytes(utf8(`AWS4${secret}`), dateStamp);
  const kRegion = await hmacBytes(kDate, region);
  const kService = await hmacBytes(kRegion, service);
  return hmacBytes(kService, "aws4_request");
}

async function hmacBytes(key, value) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, utf8(value));
  return new Uint8Array(signature);
}

async function hmacHex(key, value) {
  return hex(await hmacBytes(key, value));
}

function utf8(value) {
  return new TextEncoder().encode(value);
}

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
