import { marked } from "marked";

// Compile Markdown to a React component at build time.
//
// This is a small Vite plugin, local to the site. When any module imports a
// `.md` file, the plugin reads its front matter and body, renders the body to
// HTML with `marked`, and returns a JavaScript module that default-exports a
// React component wrapping that HTML. The named `frontmatter` export carries the
// file's metadata (title, description) to whatever route renders the page.
//
// It runs with `enforce: "pre"` so the `.md` module is already plain JavaScript
// by the time Goribu's plugins and Vite's own transforms see it. The output uses
// `createElement` rather than JSX, so nothing downstream has to transform it. The
// whole compile happens during the build; no Markdown parser ships in the Worker.
export function markdown() {
  return {
    name: "goribu-site-markdown",
    enforce: "pre",

    transform(source, id) {
      const filePath = id.split("?", 1)[0];
      if (!filePath.endsWith(".md")) return null;

      const { frontmatter, body } = parseFrontmatter(source);
      const html = marked.parse(body, { async: false });

      const module = [
        `import { createElement } from "react";`,
        `export const frontmatter = ${JSON.stringify(frontmatter)};`,
        `const __html = ${JSON.stringify(html)};`,
        `export default function MarkdownContent() {`,
        `  return createElement("div", {`,
        `    className: "prose",`,
        `    dangerouslySetInnerHTML: { __html: __html },`,
        `  });`,
        `}`,
        ``,
      ].join("\n");

      return { code: module, map: null };
    },
  };
}

// Parse an optional leading `--- ... ---` front matter block into a flat object
// of string values. This is deliberately tiny: one `key: value` per line, with
// surrounding quotes stripped. The site's front matter only needs a title and a
// description, so a full YAML parser would be a dependency spent on nothing.
function parseFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (match === null) return { frontmatter: {}, body: source };

  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (pair === null) continue;

    let value = pair[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[pair[1]] = value;
  }

  return { frontmatter, body: source.slice(match[0].length) };
}
