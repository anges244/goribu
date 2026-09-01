import { goribu } from "goribu/vite";
import { markdown } from "./plugins/markdown.js";

// The site is a Goribu application, so it runs the framework's Vite integration
// unchanged. `markdown()` is the site's own build-time step: it compiles the
// `.md` files under src/content into React components before Goribu's plugins
// touch the graph. The framework knows nothing about Markdown; this is app-level
// tooling that happens to live next to the app that uses it.
export default {
  plugins: [markdown(), goribu()],
};
