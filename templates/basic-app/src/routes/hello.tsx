import { Link } from "goribu";
import type { Meta } from "goribu";
import type { Handler } from "goribu/server";

type HelloProps = { name: string };

export const meta = { title: "Hello from a Worker" } satisfies Meta<HelloProps>;

// Request data belongs in a handler. res.render passes props to this page.
export const GET: Handler<HelloProps> = (req, res) => {
  const name = req.query.get("name")?.trim() || "friend";
  return res.headers({ "cache-control": "no-store" }).render({ name });
};

export default function HelloPage({ name }: HelloProps) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="text-4xl font-bold tracking-tight">Hello, {name}.</h1>
      <p className="mt-6 text-lg leading-relaxed text-slate-600">
        This page reads the query string on a Cloudflare Worker. Change the name
        in the URL and refresh, or follow the link home without reloading the document.
      </p>
      <p className="mt-8">
        <Link href="/" className="font-medium text-indigo-700 underline underline-offset-4">
          Back home
        </Link>
      </p>
    </main>
  );
}
