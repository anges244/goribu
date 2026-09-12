import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/typescript.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function TypeScriptDocsPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
