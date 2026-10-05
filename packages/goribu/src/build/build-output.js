import { isAbsolute, resolve } from "node:path";

export const BUILD_OUTPUT_DIRECTORY = ".goribu/dist";

/** Check the resolved environments before any build can empty an output folder. */
export function assertBuildOutputs(environments) {
  for (const environment of Object.values(environments)) {
    assertEnvironmentOutput(environment.name, environment.config);
  }
}

function assertEnvironmentOutput(name, config) {
  const expected = resolve(config.root, BUILD_OUTPUT_DIRECTORY, name);
  if (resolve(config.root, config.build.outDir) !== expected) {
    throw new Error(
      `[Goribu] The ${name} build must output to ${BUILD_OUTPUT_DIRECTORY}/${name}. ` +
        "Remove conflicting build.outDir and per-environment output overrides from your Vite configuration or plugins.",
    );
  }
  if (config.build.emptyOutDir === false) {
    throw new Error(
      `[Goribu] The ${name} build cannot use emptyOutDir: false because removed pages and navigation snapshots would remain in production output. ` +
        "Remove that override so Vite cleans the output directory on every build.",
    );
  }

  const output = config.build.rolldownOptions?.output ?? config.build.rollupOptions?.output;
  for (const options of Array.isArray(output) ? output : [output]) {
    assertBundlerOutput(options, config.root, expected);
  }
}

function assertBundlerOutput(output, root, expected) {
  // Vite resolves build.outDir against root, but a bundler-level relative dir
  // can instead use the process working directory. Only an absolute match is
  // unambiguous here; Cloudflare/Vite's derived output already supplies one.
  if (output?.file != null || (output?.dir != null &&
    (!isAbsolute(output.dir) || resolve(root, output.dir) !== expected))) {
    throw new Error(
      `[Goribu] Bundler output.dir/output.file must not redirect production output away from ${expected}. ` +
        "Remove those output overrides and let Goribu and Cloudflare select the build directories.",
    );
  }
}

export function createBuildOutputGuardPlugin() {
  let resolved;

  return {
    name: "goribu:build-output",
    // Vite's prepare-out-dir plugin also uses renderStart.order = "pre".
    // Run ahead of that built-in plugin so rejection precedes its cleanup.
    enforce: "pre",
    apply: "build",
    sharedDuringBuild: true,

    // Keep the live reference: later (including async) configResolved hooks can
    // still change environments. Validate after all of them have finished.
    configResolved(config) {
      resolved = config;
    },

    buildStart: {
      order: "post",
      sequential: true,
      handler() {
        for (const [name, config] of Object.entries(resolved.environments)) {
          assertEnvironmentOutput(name, { root: resolved.root, ...config });
        }
        assertEnvironmentOutput(this.environment.name, this.environment.config);
      },
    },

    // The final output options are available after every outputOptions hook.
    // Check again before rendering/writing, including redirects from plugins.
    renderStart: {
      order: "pre",
      sequential: true,
      handler(output) {
        const { name, config } = this.environment;
        assertEnvironmentOutput(name, config);
        assertBundlerOutput(output, config.root, resolve(config.root, BUILD_OUTPUT_DIRECTORY, name));
      },
    },

    // Cloudflare copies local .env/.dev.vars values into the Worker output for
    // `vite preview`, which Goribu does not use. Keep local secrets out of it.
    generateBundle: {
      order: "post",
      handler(_, bundle) { delete bundle[".dev.vars"]; },
    },
  };
}
