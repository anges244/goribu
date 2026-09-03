import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/middleware.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function MiddlewarePage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
