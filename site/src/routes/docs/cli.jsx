import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/cli.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function CliPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
