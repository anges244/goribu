import type { Meta } from "goribu";
import FlowBackground from "../components/flow-background";

export const meta = {
  title: "Goribu — Ready when you are",
  description: "Your starting point for a React app on Cloudflare Workers.",
} satisfies Meta;

// No handler is needed: production serves this page from Static Assets.
export default function HomePage() {
  return (
    <main className="relative isolate grid min-h-svh place-items-center px-4 py-8">
      <FlowBackground />

      <section
        aria-labelledby="welcome"
        className="relative w-full max-w-[760px] rounded-[18px] border border-line bg-panel/92 p-[22px] shadow-[0_18px_70px_rgb(0_0_0/0.045)] backdrop-blur-[10px] sm:rounded-[22px] sm:p-7"
      >
        <header className="flex items-center justify-between gap-5 pb-[42px] sm:pb-[52px]">
          <a
            href="https://goribu.dev"
            aria-label="goribu home"
            className="rounded-sm text-lg font-bold tracking-[-0.03em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            goribu
          </a>
          <span className="font-mono text-xs font-medium text-muted">
            starter
          </span>
        </header>

        <div className="px-1 pb-2.5">
          <p className="mb-[18px] flex items-center gap-2 text-[13px] font-semibold text-muted">
            <span
              aria-hidden="true"
              className="size-[7px] rounded-full bg-success ring-4 ring-success/14"
            />
            Your app is running
          </p>

          <h1
            id="welcome"
            className="max-w-[610px] text-[clamp(42px,7vw,72px)] leading-[0.98] font-bold tracking-[-0.065em]"
          >
            Ready when
            <br />
            you are.
          </h1>

          <p className="mt-[22px] mb-[30px] max-w-[530px] text-[clamp(16px,2vw,18px)] leading-[1.65] tracking-[-0.01em] text-muted">
            Start building in{" "}
            <code className="rounded-md border border-line bg-ink/3 px-1.5 py-[3px] font-mono text-[0.88em] font-medium text-ink">
              src/routes/index.tsx
            </code>
            . Goribu will take care of the rest.
          </p>

          <nav
            aria-label="Resources"
            className="flex flex-wrap items-center gap-2.5 text-sm font-semibold"
          >
            <a
              href="https://goribu.dev/docs"
              className="inline-flex min-h-[42px] items-center gap-[7px] rounded-[9px] border border-button bg-button px-[15px] text-button-text transition-transform duration-150 motion-safe:hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
            >
              Read the docs <span aria-hidden="true">↗</span>
            </a>
            <a
              href="https://goribu.dev"
              className="inline-flex min-h-[42px] items-center rounded-md px-3 text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
            >
              goribu.dev
            </a>
          </nav>
        </div>

        <footer className="mt-[54px] flex flex-col items-start justify-between gap-4 border-t border-line pt-[18px] font-mono text-xs leading-normal font-medium text-muted sm:flex-row sm:items-center">
          <span>React + Cloudflare Workers</span>
          <span>pnpm dev</span>
        </footer>
      </section>
    </main>
  );
}
