import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/kv.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function KVPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
