import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/environment-variables.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function EnvironmentVariablesPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
