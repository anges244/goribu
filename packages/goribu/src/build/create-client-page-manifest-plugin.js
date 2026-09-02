import { generateClientPageManifestSource } from "./generate-client-page-manifest-source.js";

export const CLIENT_PAGE_MANIFEST_ID = "virtual:goribu/client-pages";
const RESOLVED_CLIENT_PAGE_MANIFEST_ID = `\0${CLIENT_PAGE_MANIFEST_ID}`;

/** Supply the generated lazy page-loader map to Goribu's browser bootstrap. */
export function createClientPageManifestPlugin(manifest) {
  const source = generateClientPageManifestSource(manifest);

  return {
    name: "goribu:client-page-manifest",
    enforce: "pre",

    resolveId(id) {
      if (id === CLIENT_PAGE_MANIFEST_ID) {
        return RESOLVED_CLIENT_PAGE_MANIFEST_ID;
      }
      if (id === RESOLVED_CLIENT_PAGE_MANIFEST_ID) return id;
      return null;
    },

    load(id) {
      if (id === RESOLVED_CLIENT_PAGE_MANIFEST_ID) return source;
      return null;
    },
  };
}
