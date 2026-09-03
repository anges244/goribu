import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/navigation.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function NavigationDocsPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
