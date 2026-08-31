export default function IndexPage() {
  return (
    <main>
      <h1>Hello from Goribu</h1>
      <p>This page is server-rendered through renderToReadableStream.</p>
      <nav>
        <a href="/about">About</a> · <a href="/posts/hello-world">A post</a> ·{" "}
        <a href="/missing">A missing page</a>
      </nav>
    </main>
  );
}
