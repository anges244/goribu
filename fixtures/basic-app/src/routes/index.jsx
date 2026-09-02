import { useState } from "react";

export default function IndexPage() {
  const [count, setCount] = useState(0);

  return (
    <main>
      <h1>Hello from Goribu</h1>
      <p>This page is server-rendered through renderToReadableStream.</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Hydration count: {count}
      </button>
      <nav>
        <a href="/about">About</a> · <a href="/posts/hello-world">A post</a> ·{" "}
        <a href="/missing">A missing page</a>
      </nav>
    </main>
  );
}
