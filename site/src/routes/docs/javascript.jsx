import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/javascript.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function JavaScriptPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
