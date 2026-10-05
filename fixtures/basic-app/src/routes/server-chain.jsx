import { Link } from "goribu";
import { readServerMessage } from "../body.server.js";
import { Counter } from "./_components/index.js";

export const prerender = false;

export function GET(_req, res) {
  return res.render({ message: readServerMessage() });
}

export default function ServerChainPage({ message }) {
  return (
    <main>
      <h1>{message}</h1>
      <Counter />
      <Link href="/">Home</Link>
    </main>
  );
}
