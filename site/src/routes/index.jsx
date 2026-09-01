// The landing page. Hand-written JSX rather than Markdown: the landing is chrome,
// not prose. Like the docs pages it does no per-request work, so it is served as
// a static asset.
export default function LandingPage() {
  return (
    <div className="landing">
      <header className="hero">
        <span className="wordmark">Goribu</span>
        <h1>A React framework for Cloudflare Workers.</h1>
        <p className="lede">
          The platform's own primitives are first-class, not adapted. A real app
          goes from one command to a public URL.
        </p>
        <p className="cta">
          <a className="button" href="/docs">
            Read the docs
          </a>
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
            from Static Assets. This whole site proves it: the pages are static,
            served without invoking the Worker.
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
    </div>
  );
}
