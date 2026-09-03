import { GoribuD1Error } from "./goribu-d1-error.js";

const MISSING_D1_BINDING =
  "[Goribu] req.d1 was used but no D1 binding was found. Expected env.DB. Add\n" +
  "`database: { type: 'd1', name: 'your-db-name' }` to goribu.config.js. Goribu\n" +
  "will synthesize the env.DB binding for dev and deploy.";

/**
 * Create the lazy D1 binding resolver owned by one Worker request.
 *
 * Reading env.DB is deferred until the D1 runtime actually asks for it. The
 * result is then stable for the rest of that request. An absent binding resolves
 * to a D1-shaped fail-closed stub so later runtime layers do not need a second
 * missing-binding path.
 *
 * @param {object} env Worker bindings for one fetch invocation
 * @returns {() => object}
 */
export function createD1BindingResolver(env) {
  if (env === null || typeof env !== "object" || Array.isArray(env)) {
    throw new TypeError(
      "[Goribu] createD1BindingResolver(env) requires the Worker bindings object for one request. Pass env from the Worker fetch handler.",
    );
  }

  let resolved = false;
  let binding;

  return function resolveD1Binding() {
    if (!resolved) {
      binding = env.DB;
      if (binding === undefined || binding === null) {
        binding = createMissingD1Binding();
      }
      resolved = true;
    }

    return binding;
  };
}

/** A Cloudflare-D1-shaped binding whose every supported operation teaches repair. */
function createMissingD1Binding() {
  const fail = () => {
    throw new GoribuD1Error(MISSING_D1_BINDING);
  };

  return Object.freeze({
    prepare: fail,
    batch: fail,
    withSession: fail,
  });
}
