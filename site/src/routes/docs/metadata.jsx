import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/metadata.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function MetadataDocsPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
