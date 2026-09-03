import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/installation.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function InstallationPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
