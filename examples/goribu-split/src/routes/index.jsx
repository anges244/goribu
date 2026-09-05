import { useState } from "react";
import { Link } from "goribu";
import { euros, splitBill } from "../split-bill.js";

export const meta = {
  title: "Split a bill",
  description: "A tiny bill splitter that makes every cent add up.",
};

export default function SplitPage() {
  const [amount, setAmount] = useState("42.00");
  const [people, setPeople] = useState("3");
  const result = splitBill(amount, people);

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-widest text-indigo-700">Small tools, less fuss</p>
      <h1 className="mt-4 text-4xl font-bold tracking-tight">Split a bill.</h1>
      <p className="mt-4 text-lg text-slate-600">An even split. Every cent accounted for.</p>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6" aria-label="Bill calculator">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block font-medium" htmlFor="amount">
            Bill total (€)
            <input
              id="amount" type="text" inputMode="decimal" maxLength={9}
              value={amount} onChange={(event) => setAmount(event.target.value)}
              aria-invalid={result.field === "amount"} aria-describedby="split-result"
              className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-3 text-lg focus:outline-2 focus:outline-indigo-700"
            />
          </label>
          <label className="block font-medium" htmlFor="people">
            People
            <input
              id="people" type="text" inputMode="numeric" maxLength={3}
              value={people} onChange={(event) => setPeople(event.target.value)}
              aria-invalid={result.field === "people"} aria-describedby="split-result"
              className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-3 text-lg focus:outline-2 focus:outline-indigo-700"
            />
          </label>
        </div>

        <div id="split-result" role="status" aria-live="polite" aria-atomic="true" className="mt-6 rounded-xl bg-indigo-50 p-5">
          {result.error ? <p className="text-red-800">{result.error}</p> : (
            <>
              <p className="text-sm font-medium text-slate-600">For a total of {euros(result.total)}</p>
              {result.groups.map((group) => (
                <p key={group.cents} className="mt-2 text-xl font-semibold text-indigo-900">
                  {group.count} {group.count === 1 ? "person pays" : "people pay"} {euros(group.cents)} each
                </p>
              ))}
              {result.groups.length > 1 && <p className="mt-3 text-sm text-slate-600">Choose who covers the extra cent. Together, the shares match the bill exactly.</p>}
            </>
          )}
        </div>
        <button type="button" onClick={() => { setAmount("42.00"); setPeople("3"); }} className="mt-5 text-sm font-medium text-indigo-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">
          Reset example
        </button>
      </section>

      <p className="mt-6 text-sm text-slate-600">Calculations stay in this page. Nothing is saved. JavaScript is required to change the amounts.</p>
      <p className="mt-6"><Link href="/about" className="font-medium text-indigo-700 underline underline-offset-4">How it works</Link></p>
    </main>
  );
}
