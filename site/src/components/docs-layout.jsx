// The shared chrome for every documentation page: a sidebar of links and the
// rendered Markdown content. The sidebar is a plain list of `<a>` links for now;
// client-side navigation (`<Link>`, prefetch) arrives with the client runtime in
// Block 5, at which point these become framework-aware without changing shape.
// The guided-tour order. Each page ends by linking to the next; the sidebar is
// the same sequence, always visible.
const NAV = [
  { href: "/docs", label: "Introduction" },
  { href: "/docs/installation", label: "Getting started" },
  { href: "/docs/cli", label: "The CLI" },
  { href: "/docs/routing", label: "Routing" },
  { href: "/docs/rendering", label: "Rendering" },
  { href: "/docs/handlers", label: "Handlers" },
  { href: "/docs/middleware", label: "Middleware" },
  { href: "/docs/errors", label: "Errors" },
  { href: "/docs/static-routes", label: "Static routes" },
  { href: "/docs/javascript", label: "JavaScript" },
  { href: "/docs/deploy", label: "Deploying" },
];

export default function DocsLayout({ frontmatter, children }) {
  const title = frontmatter?.title;

  return (
    <div className="layout">
      <aside className="sidebar">
        <a className="brand" href="/">
          Goribu
        </a>
        <nav>
          <ul>
            {NAV.map((item) => (
              <li key={item.href}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main className="content">
        <article>
          {title ? <h1>{title}</h1> : null}
          {children}
        </article>
      </main>
    </div>
  );
}
