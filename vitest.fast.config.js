import { configDefaults, defineConfig } from "vitest/config";

// Keep `pnpm test` complete. This opt-in subset skips real builds, Worker
// servers, package archives, CLI dispatch, and TypeScript compiler checks.
export default defineConfig({
  test: {
    maxWorkers: 4,
    exclude: [
      ...configDefaults.exclude,
      "**/*.integration.test.js",
      "**/*-vite.test.js",
      "**/client-asset-fingerprints.test.js",
      "**/build-warning-filter.test.js",
      "**/goribu-cli.test.js",
      "**/cloudflare-login-guidance.test.js",
      "**/public-types.test.js",
      "**/scaffold.test.js",
      "**/release.test.js",
    ],
  },
});
