import { Link } from "goribu";
import { useState } from "react";

export const meta = {
  title: "Goribu - a React framework for Cloudflare Workers",
  description:
    "A React framework built directly for Cloudflare Workers and their Web primitives.",
};

// The landing page. Hand-written JSX rather than Markdown: the landing is chrome,
// not prose. Like the docs pages it does no per-request work, so it is served as
// a static asset.
export default function LandingPage() {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className="landing">
      <header className="hero">
        <span className="wordmark">Goribu</span>
        <h1>A React framework for Cloudflare Workers.</h1>
        <p className="lede">
          The platform's own primitives are first-class, not adapted. Start with
          JavaScript and Tailwind, then deploy your app to a public URL.
        </p>
        <p className="cta">
          <Link className="button" href="/docs/installation">
            Get started
          </Link>
          {" "}<Link href="/community">Community feedback</Link>
        </p>
      </header>

      <section className="pillars">
        <div className="pillar">
          <h2>Server-rendered and hydrated</h2>
          <p>
            Every route is streamed from the server and hydrates in the browser.
            Interactive routes require JavaScript — a decision, documented as one.
          </p>
        </div>
        <div className="pillar">
          <h2>Static where it can be</h2>
          <p>
            A route whose first response needs no Worker is built once and served
            from Static Assets. This landing page and the docs are static;
            feedback and the community feed run on the Worker.
          </p>
        </div>
        <div className="pillar">
          <h2>One way to do each thing</h2>
          <p>
            No adapter layers built for cases that do not exist yet. One
            implementation until there is a second, then an abstraction with two
            real examples in hand.
          </p>
        </div>
      </section>

      <section className="why-goribu" aria-labelledby="why-goribu-heading">
        <button
          className="why-goribu-toggle"
          type="button"
          aria-expanded={detailsOpen}
          aria-controls="why-goribu-details"
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <span id="why-goribu-heading">Why Goribu?</span>
          <span aria-hidden="true">{detailsOpen ? "−" : "+"}</span>
        </button>
        {detailsOpen ? (
          <p id="why-goribu-details">
            Cloudflare Workers already provide the runtime primitives an
            application needs. Goribu keeps those primitives visible while React
            owns rendering and interaction.
          </p>
        ) : null}
      </section>
    </div>
  );
}
