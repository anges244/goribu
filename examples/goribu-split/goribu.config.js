import { defineConfig } from "goribu/server";

export default defineConfig({
  // Choose your own Worker name before deploying a new app.
  name: "goribu-split",
  compatibilityDate: "2026-08-31",

  // Optional resources: choose app-specific names and uncomment either line.
  // database: { type: "d1", name: "goribu-split-db" },
  // kv: { name: "goribu-split-kv" },
});
