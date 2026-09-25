# AGENTS.md — Goribu

Read this file before changing the repository.

This file covers how to work in this repo and what the framework guarantees.
It is self-contained; a fresh clone needs no private planning files. Read
`CONTRIBUTING.md` for local setup and validation commands.

If the maintainer has supplied a local `START.md`, read it for the active task
and handoff context. It is optional, untracked, and not required to contribute.

## Sources of truth

1. The maintainer's current request defines the task and scope.
2. `docs/decisions.md` records settled design choices. Follow them exactly unless
   concrete implementation evidence invalidates one; then stop and ask rather
   than silently diverging.
3. `CHANGELOG.md` records release changes, and the current guides under `docs/`
   describe the supported behavior.

Historical block writeups and review notes are kept in a local, ignored archive.
They are not required to work on the repository. Nothing is recorded as complete
that has no source in the tree.

## Working cadence

- Work on one agreed task or block at a time and one substep at a time.
- Before each substep, state which step is being implemented and why it exists.
- Implement, explain, validate, then pause for maintainer review.
- A block ends at a public URL that changed, not at a passing test run. Its
  "Done when" must be literally true against something live.
- A block ends clean. No technical debt is carried out of the block that created
  it.
- A passing test is not enough: keep the implementation understandable, minimal,
  and explainable.
- Do not install pnpm or npm dependencies. Provide the exact install command and
  wait for the maintainer to run it and confirm.
- Do not deploy. Deployment is maintainer-owned: provide the exact deploy command
  and wait for the maintainer to run it and confirm before performing live
  verification.
- Do not commit or create branches. Notify the maintainer when a coherent,
  passing commit boundary is reached and provide a suggested commit message.
- Preserve unrelated maintainer work; never overwrite or revert it.

## Product invariants

- Target Cloudflare Workers using Web `Request` and `Response` primitives.
- Worker entrypoints expose `fetch(request, env, ctx)`; bindings arrive through
  `env`, and background work uses `ctx.waitUntil`.
- SSR streams rather than buffering, and framework cookies flush onto the
  returned `Response`.
- Keep `/_goribu/` reserved for framework internals.
- Use one canonical public API for each task. Avoid aliases and overlapping ways
  to do the same thing.
- Errors must teach: failures identify the problem and tell the user how to
  repair it. Prefix framework-originated errors with `[Goribu]` using that
  capitalization.
- Build and bundle guards fail closed when safety cannot be proven.
- Static and dynamic routes are equally first-class. Static output is what the
  build produces when a route needs no Worker, not a bolted-on feature.
  Successfully prerendered pages use Static Assets for production document
  loads, client navigation, and prefetch. Navigation must preserve this
  no-Worker guarantee and use the HTML's build-time props and metadata.
- Interactive routes require JavaScript by design. Forms and client navigation
  are hydrated-only; static routes work without JS because they are plain HTML.
  This is a decision, and it is documented as one rather than assumed.
- Build no abstraction for a second implementation that does not exist. When a
  second case arrives, factor then, with both cases in hand.

## Repository shape

- Framework source: `packages/goribu/src/`
- CLI entrypoint: `packages/goribu/bin/goribu.js`
- Behavioral integration fixture: `fixtures/basic-app/`
- Legacy site and integration test app: `site/`
- Product documentation: `docs/`

Framework runtime source is plain JavaScript ESM with no package build step.
Hand-written public TypeScript declarations ship at all four public entries.
Keep them synchronized with every public runtime change and protect them with
type fixtures. The canonical application starter uses TypeScript; packaging
derives the JavaScript variant from it.

The `goribu` package has four deliberate public entries:

- `goribu` for shared public APIs
- `goribu/server` for Worker runtime APIs
- `goribu/client` for browser runtime APIs
- `goribu/vite` for build integration

Do not blur these boundaries or introduce imports that can leak server or build
code into browser bundles.

The fixture and the in-repository site exercise framework behavior. The public
website is maintained independently in a separate private repository.

## Tests and validation

- Prefer a few tests that exercise observable behavior and realistic failures.
- Do not create test volume by restating constants, mirroring implementation
  details, or splitting one trivial contract into many assertions.
- Add regression tests for fixed bugs and focused contract tests for public
  behavior.
- Use `fixtures/basic-app` when a feature needs integration proof rather than
  mocking away the framework boundary.
- Run the narrowest relevant check first, then `pnpm test` when the broader
  workspace signal is useful.
- Never claim a command passed unless it was actually run and observed.

## Documentation

Write each topic under `docs/` as the closing substep of the block that
implements it. Documentation is part of API validation: if the canonical path is
awkward to explain, revisit the API rather than documenting accidental
complexity.

Append newly resolved forks to `docs/decisions.md`; do not rewrite prior
decisions to hide design history. Record deliberate omissions too, so that "not
yet" stays visible instead of becoming invisible.

## Generated and local state

Do not edit generated output or dependency state such as `node_modules/`,
`dist/`, `.goribu/`, `.wrangler/`, coverage output, or package-manager caches.

Private maintainer planning files are outside the contributor workflow. Do not
read or modify them unless the maintainer's task or local handoff directs it,
and do not add dependencies on them to tracked files.
