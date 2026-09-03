import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/handlers.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function HandlersPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
