import { defineConfig } from "goribu/server";

export default defineConfig({
  name: "goribu-site",
  compatibilityDate: "2026-08-31",
  responseHeaders({ mode, nonce }) {
    return mode === "production"
      ? {
          "content-security-policy":
            `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self'`,
        }
      : {};
  },
});
