import { useState } from "react";
import { Link } from "goribu";

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
        <Link href="/">Home</Link> · <Link href="/about">About</Link> ·{" "}
        <Link href="/greet">Greeting</Link> · <Link href="/posts/hello-world">A post</Link> ·{" "}
        <Link href="/missing">A missing page</Link>
      </nav>
    </main>
  );
}
