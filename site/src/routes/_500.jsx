export const meta = { title: "Something went wrong - Goribu", robots: "noindex" };

// The application's server-error page. It renders for an unhandled error in
// production, receiving the request pathname and a correlation ID. The raw error
// never reaches this page; the ID is what ties it to the logged error. Being a
// top-level reserved file, it adds no middleware and downgrades no route.
export default function ServerError({ url, errorId }) {
  return (
    <main className="content">
      <article>
        <h1>Something went wrong</h1>
        <p>
          We hit an unexpected error while handling <code>{url}</code>.
        </p>
        <p>
          If you report this, please include the reference below so we can find it
          in our logs.
        </p>
        <p>
          Reference: <code>{errorId}</code>
        </p>
        <p>
          <a href="/">Back to home</a>
        </p>
      </article>
    </main>
  );
}
