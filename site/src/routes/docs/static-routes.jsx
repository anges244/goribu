import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/static-routes.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function StaticRoutesPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
