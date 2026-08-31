export default function PostPage() {
  return (
    <main>
      <h1>A post</h1>
      <p>
        This is a dynamic route: <code>/posts/[id]</code> matches any single
        segment. Reading the <code>id</code> needs a request handler, which
        arrives in a later block, so this page renders the same for every id.
      </p>
      <nav>
        <a href="/">Home</a>
      </nav>
    </main>
  );
}
