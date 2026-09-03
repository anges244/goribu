import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/errors.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function ErrorsPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
