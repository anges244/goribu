import { createContext } from "react";

export const FormUploadContext = createContext(null);
export const UploadHintsContext = createContext(null);

// These are picker hints, never authorization. Keep server-only policy fields out.
export function readUploadHints(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidHints();
  const hints = Object.create(null);
  for (const [name, policy] of Object.entries(value)) {
    if (!policy || !Array.isArray(policy.accept) || !policy.accept.every((type) => typeof type === "string") ||
        !Number.isSafeInteger(policy.maxBytes) || policy.maxBytes <= 0) throw invalidHints();
    hints[name] = { accept: policy.accept, maxBytes: policy.maxBytes };
  }
  return hints;
}

function invalidHints() {
  return new TypeError("[Goribu] Invalid upload hints in page data. Rebuild the Worker and client together.");
}
