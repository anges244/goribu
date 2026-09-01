// A route that exports both a default page and a GET handler. The handler runs
// instead of an implicit GET render, reads a query param through the request
// surface, and returns res.render(props) so the route's own page renders with
// handler-supplied data through the same document shell a page match uses.
export default function GreetPage({ name }) {
  return (
    <main>
      <h1>Hello, {name ?? "world"}</h1>
      <p>This page was rendered by a GET handler that returned res.render(props).</p>
      <nav>
        <a href="/">Home</a>
      </nav>
    </main>
  );
}

export function GET(req, res) {
  return res.render({ name: req.query.get("name") ?? "world" });
}
