// Minimal placeholder Worker entry so the build pipeline has something to bundle.
// The next substep replaces this with a generated entry that renders a hardcoded
// React page through renderToReadableStream.
export default {
  fetch() {
    return new Response("[Goribu] build pipeline is live.", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
