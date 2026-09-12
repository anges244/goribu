import { useState } from "react";
import { Link } from "goribu";
import type { Meta } from "goribu";

export const meta = {
  title: "Hello from Goribu",
  description: "A small starting point for your next Cloudflare app.",
} satisfies Meta;

// With no request handler, this page is built as a static asset. It still
// hydrates in the browser, so the counter needs no Worker request.
export default function HomePage() {
  const [count, setCount] = useState(0);

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="text-sm font-semibold uppercase tracking-widest text-indigo-700">
        Your next app starts here
      </p>
      <h1 className="mt-4 text-4xl font-bold tracking-tight">Hello from Goribu.</h1>
      <p className="mt-6 text-lg leading-relaxed text-slate-600">
        Edit <code className="text-slate-950">src/routes/index.tsx</code> and make
        this yours. Tailwind is ready to use.
      </p>
      <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-6" aria-label="Hydration example">
        <p className="text-slate-600">Static HTML, interactive after hydration.</p>
        <button
          type="button"
          onClick={() => setCount((value) => value + 1)}
          className="mt-4 rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-700"
        >
          Count: {count}
        </button>
      </section>
      <p className="mt-8">
        <Link href="/hello?name=friend" className="font-medium text-indigo-700 underline underline-offset-4">
          Try a Worker-rendered page
        </Link>
      </p>
    </main>
  );
}
