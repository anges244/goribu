import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/routing.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function RoutingPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
