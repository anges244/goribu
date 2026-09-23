import { Link } from "goribu";

export default function AboutPage() {
  return (
    <main>
      <h1>About</h1>
      <p>A second static route, served from Static Assets for document and client navigation.</p>
      <nav>
        <Link href="/">Home</Link> · <Link href="/about">About</Link>
      </nav>
    </main>
  );
}
