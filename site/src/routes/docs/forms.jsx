import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/forms.md";

export const meta = {
  title: frontmatter.title,
  description: frontmatter.description,
};

export default function FormsDocsPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
