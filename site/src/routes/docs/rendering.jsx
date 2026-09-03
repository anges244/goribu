import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/rendering.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function RenderingPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
