import DocsLayout from "../../components/docs-layout.jsx";
import Content, { frontmatter } from "../../content/docs/introduction.md";

// A documentation route: it imports its Markdown content — compiled to a React
// component by the site's markdown plugin — and renders it inside the shared docs
// layout. The route does no per-request work, so Goribu serves it as a static
// asset. One thin route file per page keeps every doc URL explicit.
export default function IntroductionPage() {
  return (
    <DocsLayout frontmatter={frontmatter}>
      <Content />
    </DocsLayout>
  );
}
