import { Link } from "goribu";

export const meta = { title: "How the split works" };

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="text-4xl font-bold tracking-tight">Every cent adds up.</h1>
      <p className="mt-6 text-lg leading-relaxed text-slate-600">
        The calculator turns the bill into whole cents, divides them evenly,
        then gives any remaining cents to one person each. For €10.00 split
        three ways, one person pays €3.34 and two people pay €3.33.
      </p>
      <p className="mt-4 text-slate-600">There are no accounts, databases, or saved bills. Both pages are built as static HTML; the calculator runs in your browser after hydration. Returning to it starts a fresh example.</p>
      <p className="mt-8">
        <Link href="/" className="font-medium text-indigo-700 underline underline-offset-4">
          Back to the calculator
        </Link>
      </p>
    </main>
  );
}
