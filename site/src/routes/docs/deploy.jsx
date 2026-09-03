import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/deploy.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function DeployPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
