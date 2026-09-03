export const meta = { title: "Page not found - Goribu", robots: "noindex" };

export default function NotFoundPage() {
  return (
    <main className="content">
      <article>
        <h1>Page not found</h1>
        <p>
          That page does not exist. Head back to the <a href="/">home page</a> or
          the <a href="/docs">documentation</a>.
        </p>
      </article>
    </main>
  );
}
