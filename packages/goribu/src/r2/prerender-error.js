export const SIGNED_URL_PRERENDER_ERROR = "[Goribu] req.r2.signedUrl() cannot run during prerendering: the link would expire inside static HTML. Set prerender = false on this route.";
const errors = new WeakSet();

export function signedUrlPrerenderError() {
  const error = new Error(SIGNED_URL_PRERENDER_ERROR);
  errors.add(error);
  return error;
}

export function isSignedUrlPrerenderError(error) {
  return errors.has(error);
}
