import { Link, NavLink } from "goribu";

// The shared chrome for every documentation page. The guided-tour order appears
// in a persistent sidebar whose links navigate and prefetch through Goribu's
// hydrated client runtime.
const NAV = [
  { href: "/docs", label: "Introduction" },
  { href: "/docs/installation", label: "Getting started" },
  { href: "/docs/cli", label: "The CLI" },
  { href: "/docs/routing", label: "Routing" },
  { href: "/docs/rendering", label: "Rendering" },
  { href: "/docs/handlers", label: "Handlers" },
  { href: "/docs/middleware", label: "Middleware" },
  { href: "/docs/errors", label: "Errors" },
  { href: "/docs/navigation", label: "Navigation" },
  { href: "/docs/forms", label: "Forms" },
  { href: "/docs/metadata", label: "Metadata & Document" },
  { href: "/docs/static-routes", label: "Static routes" },
  { href: "/docs/javascript", label: "JavaScript" },
  { href: "/docs/deploy", label: "Deploying" },
];

export default function DocsLayout({ frontmatter, children }) {
  const title = frontmatter?.title;

  return (
    <div className="layout">
      <aside className="sidebar">
        <Link className="brand" href="/">
          Goribu
        </Link>
        <nav>
          <ul>
            {NAV.map((item) => (
              <li key={item.href}>
                <NavLink href={item.href} end={item.href === "/docs"}>
                  {item.label}
                </NavLink>
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
