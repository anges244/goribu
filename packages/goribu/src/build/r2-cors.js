import { isDeepStrictEqual } from "node:util";

const RULE_ID = "goribu-uploads";
const METHODS = new Set(["GET", "PUT", "POST", "DELETE", "HEAD"]);

// Retain whole rules, including unfamiliar properties, so an update cannot
// silently discard settings owned by someone else.
export function validateR2CorsRules(value) {
  if (!Array.isArray(value)) throw invalidCors();
  let owned = 0;
  for (const rule of value) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule) ||
        !strings(rule.allowed?.origins, true) || !strings(rule.allowed?.methods, true) ||
        !rule.allowed.methods.every((method) => METHODS.has(method)) ||
        (rule.allowed.headers !== undefined && !strings(rule.allowed.headers)) ||
        (rule.id !== undefined && (typeof rule.id !== "string" || !rule.id)) ||
        (rule.exposeHeaders !== undefined && !strings(rule.exposeHeaders)) ||
        (rule.maxAgeSeconds !== undefined && (!Number.isInteger(rule.maxAgeSeconds) || rule.maxAgeSeconds < 0))) throw invalidCors();
    if (rule.id === RULE_ID && ++owned > 1) throw invalidCors();
  }
  return value;
}

export function mergeR2UploadCors(rules, origins) {
  validateR2CorsRules(rules);
  if (!strings(origins, true) || origins.some((origin) => {
    try {
      const url = new URL(origin);
      return !["http:", "https:"].includes(url.protocol) || url.origin !== origin ||
        url.hostname.includes("*");
    } catch { return true; }
  })) throw new Error("[Goribu] Direct-upload CORS needs verified application origins. Configure the app's Cloudflare hostnames, then rerun `goribu check` before deploying.");
  const managed = {
    id: RULE_ID,
    allowed: {
      origins: [...new Set(origins)].sort(),
      methods: ["PUT"],
      headers: ["content-type", "cache-control", "if-none-match", "x-amz-meta-goribu-upload"],
    },
    maxAgeSeconds: 3600,
  };
  const index = rules.findIndex((rule) => rule.id === RULE_ID);
  const merged = [...rules];
  if (index === -1) merged.push(managed);
  else merged[index] = managed;
  return { rules: merged, changed: !isDeepStrictEqual(rules, merged) };
}

function strings(value, nonempty = false) {
  return Array.isArray(value) && (!nonempty || value.length > 0) &&
    value.every((entry) => typeof entry === "string" && entry.length > 0);
}

function invalidCors() {
  return new Error("[Goribu] Cloudflare returned invalid or ambiguous R2 CORS rules. Inspect the bucket's CORS settings in Cloudflare and update Goribu before retrying; existing rules cannot safely be replaced.");
}
