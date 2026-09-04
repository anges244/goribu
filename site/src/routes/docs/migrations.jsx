import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/migrations.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function MigrationsPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
