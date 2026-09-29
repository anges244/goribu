export const DOWNLOAD_PURPOSE = "goribu.r2get.v1";
export const UPLOAD_PURPOSE = "goribu.upload.v1";
const encoder = new TextEncoder();

// Purpose separation and WebCrypto verification keep upload refs and download
// links distinct even when they share the app's key. No token or key is logged.
export async function signToken(payload, secret, purpose) {
  const key = await importKey(secret, "sign");
  const encoded = encode(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${purpose}.${encoded}`));
  return `${encoded}.${encode(new Uint8Array(signature))}`;
}

export async function verifyToken(token, secret, purpose, now = Math.floor(Date.now() / 1000)) {
  const key = await importKey(secret, "verify");
  if (typeof token !== "string" || token.length > 16384) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  let signature, payloadBytes;
  try {
    signature = decode(parts[1]);
    payloadBytes = decode(parts[0]);
  } catch { return null; }
  if (signature.length !== 32) return null;
  if (!await crypto.subtle.verify("HMAC", key, signature, encoder.encode(`${purpose}.${parts[0]}`))) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes)); }
  catch { return null; }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload) ||
    !Number.isSafeInteger(payload.exp) || payload.exp <= now) return null;
  return payload;
}

async function importKey(secret, operation) {
  if (typeof secret !== "string" || !secret.length) {
    throw new Error("[Goribu] GORIBU_SECRET is required for signed R2 links and upload refs. Configure the Worker secret with wrangler secret put GORIBU_SECRET; local development needs it in dev vars until automatic provisioning is available.");
  }
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [operation]);
}

function encode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(encoded) {
  const bytes = Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
  if (encode(bytes) !== encoded) throw new Error("Noncanonical base64url");
  return bytes;
}
