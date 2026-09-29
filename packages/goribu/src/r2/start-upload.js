import { signToken, UPLOAD_PURPOSE } from "./token.js";
import { presignS3Url } from "./sigv4.js";
import { requireR2SigningCredentials } from "./signing-credentials.js";
import { acceptsUploadType, sanitizeUploadName, validUploadKey, UPLOAD_CACHE_CONTROL, UPLOAD_METADATA_KEY } from "./upload-ref.js";

/** Called after selected middleware, using its very same req and res. */
export async function startUpload({ req, res, route, policies, config, mode }) {
  res.headers({ "cache-control": "no-store" });
  const field = req.headers.get("x-goribu-upload");
  if (!Object.hasOwn(policies, field)) return res.status(400).json({ code: "field" });
  const policy = policies[field];
  let input;
  try { input = JSON.parse(new TextDecoder().decode(await req.rawBody())); }
  catch { return res.status(400).json({ code: "type" }); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return res.status(400).json({ code: "type" });
  const type = input.type === "" ? "application/octet-stream" : input.type;
  if (!acceptsUploadType(type, policy.accept)) return res.status(400).json({ code: "type" });
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > policy.maxBytes) return res.status(400).json({ code: "size" });
  if (typeof input.name !== "string") return res.status(400).json({ code: "name" });
  const file = Object.freeze({ name: sanitizeUploadName(input.name), type, size: input.size });
  const ext = /\.[a-z0-9]{1,9}$/i.exec(file.name)?.[0].toLowerCase() ?? "";
  const key = policy.key ? policy.key({ req, file, ext }) : `uploads/${crypto.randomUUID()}${ext}`;
  if (!validUploadKey(key)) {
    // Do not print the result: an application key function may return sensitive data.
    throw new TypeError(`[Goribu] Route ${JSON.stringify(route.id)} uploads.${field}.key must synchronously return a non-empty Unicode key of at most 1024 UTF-8 bytes without a leading / or . or .. path segments. Return a new object key for each upload, or remove key to generate one.`);
  }
  const now = Math.floor(Date.now() / 1000);
  const bucket = policy.private ? "private" : "default";
  const uploadId = crypto.randomUUID();
  const ref = await signToken({ route: route.pattern, field, bucket, key, uploadId, ...file, putExp: now + 60, exp: now + 3600 }, req.env.GORIBU_SECRET, UPLOAD_PURPOSE);
  const headers = { "content-type": type };
  let url = `/_goribu/r2/upload?ref=${encodeURIComponent(ref)}`;
  if (mode === "production" && policy.direct) {
    const { accountId, accessKeyId, secretAccessKey } = requireR2SigningCredentials(req.env, "direct uploads");
    headers["if-none-match"] = "*";
    headers[`x-amz-meta-${UPLOAD_METADATA_KEY}`] = uploadId;
    if (bucket === "default" && config.domain) headers["cache-control"] = UPLOAD_CACHE_CONTROL;
    url = await presignS3Url({ method: "PUT", accountId, bucket: policy.private ? config.private.name : config.name,
      key, accessKeyId, secretAccessKey, expiresIn: 60, jurisdiction: config.jurisdiction,
      headers: { ...headers, "content-length": String(file.size) } });
  }
  // Content-Length is signed for S3, but only the browser can set that header.
  return res.json({ target: { url, method: "PUT", headers }, ref });
}
