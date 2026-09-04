import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/d1.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function D1Page() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
