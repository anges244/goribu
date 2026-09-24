const PREFIX = "_goribu/assets/";

/** Track bundler-generated names instead of guessing entropy from their letters. */
export function createClientAssetFingerprints() {
  let inputs = [];
  let assetNames = new Set();
  let verificationPattern;

  return {
    outputOptions(options) {
      inputs = [];
      assetNames = new Set();
      const naming = options.assetFileNames;
      return {
        ...options,
        assetFileNames(asset) {
          if (verificationPattern !== undefined) return verificationPattern;
          const pattern = typeof naming === "function" ? naming(asset) : naming;
          if (pattern?.startsWith(PREFIX) && /\[hash(?::8)?\]/.test(pattern)) {
            inputs.push({
              name: asset.names[0], pattern,
              source: typeof asset.source === "string" ? asset.source : new Uint8Array(asset.source),
            });
          }
          return pattern;
        },
      };
    },

    verifyAssets(bundle, context) {
      // Ask the bundler for the names of the original asset sources. It deduplicates
      // these emissions against the existing assets. Rehashing final CSS ourselves
      // would be wrong: Vite replaces asset URL placeholders after naming it.
      const existing = new Set(Object.keys(bundle));
      try {
        for (const asset of inputs) {
          // Reuse the original pattern without invoking app callbacks again.
          verificationPattern = asset.pattern;
          const reference = context.emitFile({
            type: "asset", name: asset.name, source: asset.source,
          });
          assetNames.add(context.getFileName(reference));
        }
      } finally {
        verificationPattern = undefined;
        // Vite also calls assetFileNames to calculate directories without emitting
        // an asset. Do not leave outputs from those naming-only calls in the build.
        for (const name of Object.keys(bundle)) {
          if (!existing.has(name)) delete bundle[name];
        }
        inputs = [];
      }
    },

    findUnhashed(bundle, context) {
      this.verifyAssets(bundle, context);
      const chunkNames = new Set(Object.values(bundle)
        .filter((file) => file.type === "chunk" && hasChunkHash(file))
        .map((file) => file.fileName));

      for (const [name, file] of Object.entries(bundle)) {
        if (!name.startsWith(PREFIX)) continue;
        if (file.type === "chunk" ? chunkNames.has(name) : assetNames.has(name)) continue;
        // Bundler sourcemaps share their owning chunk's fingerprint.
        if (file.type === "asset" && name.endsWith(".map") && chunkNames.has(name.slice(0, -4))) continue;
        return name;
      }
      return null;
    },
  };
}

function hasChunkHash(chunk) {
  const preliminary = chunk.preliminaryFileName;
  if (typeof preliminary !== "string") return false;
  const placeholder = /!~\{[0-9a-zA-Z_$]+\}~/g;
  let offset = 0;
  let found = false;

  for (const match of preliminary.matchAll(placeholder)) {
    if (chunk.fileName.slice(offset, match.index) !== preliminary.slice(offset, match.index)) return false;
    const hash = chunk.fileName.slice(match.index, match.index + match[0].length);
    if (!/^[A-Za-z0-9_-]{8}$/.test(hash)) return false;
    offset = match.index + match[0].length;
    found = true;
  }

  return found && chunk.fileName.slice(offset) === preliminary.slice(offset);
}
