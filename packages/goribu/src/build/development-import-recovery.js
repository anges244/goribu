/** Retry server imports that Vite could not connect to its file graph yet. */
export function createDevelopmentImportRecoveryPlugin() {
  const missingByEnvironment = new WeakMap();
  function missingImports(environment) {
    let missing = missingByEnvironment.get(environment);
    if (!missing) missingByEnvironment.set(environment, missing = new Map());
    return missing;
  }

  return {
    name: "goribu:development-import-recovery",
    apply: "serve",
    enforce: "pre",

    async resolveId(source, importer, options) {
      if (this.environment.config.consumer !== "server" || !importer ||
          source.startsWith("\0")) return null;
      // Native tsconfig paths still look like package imports here. Let Vite
      // resolve them before deciding which imports need a later retry.
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      const missing = missingImports(this.environment);
      if (resolved === null || resolved.meta?.["vite:alias"]?.noResolved) {
        let sources = missing.get(importer);
        if (!sources) missing.set(importer, sources = new Set());
        sources.add(source);
      } else {
        missing.get(importer)?.delete(source);
        if (missing.get(importer)?.size === 0) missing.delete(importer);
      }
      return resolved;
    },

    transform(_code, id) {
      // A new transform replaces the import list, including removed bad imports.
      missingByEnvironment.get(this.environment)?.delete(id);
    },

    async hotUpdate({ type, file, modules, timestamp, server }) {
      const environment = this.environment;
      const missing = missingByEnvironment.get(environment);
      if (!missing?.size) return;
      if (type === "delete") {
        missing.delete(file);
        for (const mod of modules) missing.delete(mod.id);
        return;
      }
      if (type !== "create") return;
      const recovered = new Set();
      for (const [importer, sources] of [...missing]) {
        for (const source of [...sources]) {
          // Ask Vite again: aliases, extension inference, and directory imports
          // must follow the same resolver as the original import.
          const resolved = await environment.pluginContainer.resolveId(source, importer);
          if (!resolved || resolved.external || resolved.meta?.["vite:alias"]?.noResolved) continue;
          const mod = environment.moduleGraph.getModuleById(importer);
          if (mod) recovered.add(mod);
        }
      }
      if (!recovered.size) return;

      // Server import analysis leaves missing imports out of the file graph.
      // Invalidate their importers, then clear the runner's failed evaluation.
      // A reload attributed to the new file is ignored by the runner because it
      // has never successfully loaded that file. Leave that attribution out so
      // the runner retries its entrypoints after the importer invalidation.
      const invalidated = new Set();
      for (const mod of new Set([...modules, ...recovered])) {
        environment.moduleGraph.invalidateModule(mod, invalidated, timestamp, true);
      }
      environment.hot.send({ type: "full-reload" });
      server.environments.client.hot.send({ type: "full-reload" });
      return [];
    },
  };
}
