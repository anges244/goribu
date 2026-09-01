# Block 3 — The site

The first real Goribu app: the framework's own documentation site, built on a
framework that so far does routing and rendering and nothing else. That is
exactly enough for a docs site, which is why it comes here rather than at the end.
From this point the site is the proving ground — every later capability is
exercised on it before it is documented.

The whole block landed **without changing a line of framework source.** Routing,
streamed SSR, static output, and the CLI were sufficient to build and ship a
real content site. Markdown support is app-level tooling that composes on top.

## What landed

- **The `site/` app** — a Goribu application at the repo root, its own Worker
  (`goribu-site`), added to the pnpm workspace. Landing page, seven docs pages, a
  custom `_document.jsx` and `_404.jsx`, and a stylesheet served from `public/`.
- **A build-time Markdown step** — `site/plugins/markdown.js`, a small Vite plugin
  local to the site. On any `.md` import it parses front matter, renders the body
  to HTML with `marked`, and returns a module that default-exports a React
  component (plus a `frontmatter` named export). It runs `enforce: "pre"` and
  emits `createElement`, so nothing downstream re-transforms it, and the compile
  happens entirely at build time — no Markdown parser ships in the Worker.
- **The content model** — Markdown lives in `src/content/docs/*.md`, outside the
  route tree. A thin `.jsx` route per page imports its compiled `.md` and renders
  it inside a shared `DocsLayout`. One route file per URL, explicit.
- **A guided-tour docs set** — Introduction, Getting started, The CLI, Routing,
  Rendering, Static routes, JavaScript, Deploying. Scoped to exactly what ships
  today (Blocks 1–2); every example is complete and runnable; each page ends by
  linking to the next, and the sidebar is the same sequence.
- **The JavaScript position** — its own docs page stating the two axes and today's
  honest reality: every route is server-rendered, statically output, and HTML-only,
  because the browser runtime has not shipped yet.
- **Docs** — this writeup and a changelog entry. The guided tour *is* the block's
  user-facing documentation.

## What emerged

- **The route-extension boundary made Markdown an app-level concern, cleanly.**
  The route scanner only routes `.js/.jsx/.ts/.tsx`, so a `.md` file cannot be a
  route directly. Rather than widen the framework, Markdown stays in `src/content`
  and is pulled in by thin route modules. This forced no framework change — and
  that is the point: a real docs site was built by composition on top of the
  existing surface, which is the "one implementation until there is a second"
  posture paying off.
- **The static-output pipeline generalized to real content with zero friction.**
  `goribu build` ran the emitted Worker in workerd and prerendered all nine pages
  — Markdown-derived and hand-written alike — to static HTML. Block 2's mechanism,
  built against a three-page fixture, handled a real multi-page site unchanged.
- **`marked` is the one added dependency,** and it is a dev/build dependency only.
  Front matter is parsed by a tiny local function rather than pulling in a YAML
  parser for two fields.

## Non-obvious choices

- **Markdown is the site's tooling, not the framework's.** The plugin lives in the
  site, the framework knows nothing about it, and the framework was not touched.
  When a second app wants Markdown, the shared version gets designed with two real
  cases in hand — not guessed at now.
- **Content sits outside `src/routes/`.** Keeping `.md` in `src/content` and
  routing through explicit `.jsx` files means each doc URL is visible in the route
  tree and the framework's route contract is unchanged.
- **The docs document only what ships.** No forms, middleware, or data pages, even
  though v2 had that prose — the ledger never lies, so the site describes the
  framework that exists, and grows as later blocks land.
- **The tutorial is folded into the guided docs.** With only routing and rendering
  shipped, a standalone tutorial would restate the Getting-started → CLI → Deploy
  path. It becomes its own page when there is more to teach.

## Verification — the "Done when"

Live at **https://goribu-site.aggelos-gesoulis.workers.dev**.

- **The site builds and deploys.** Landing plus eight docs URLs all `200`, each
  docs page rendering its front-matter title and its compiled Markdown; `/missing`
  a custom `404`; `/styles.css` served as `text/css`.
- **Every route is static.** `goribu build` reports nine routes statically output,
  served from Static Assets without invoking the Worker — the whole site is at the
  static/HTML-only corner of the two axes.
- **Trailing slashes canonicalize on the live site** (`/docs/routing/` → `307` →
  `/docs/routing`).
- **Improving a page is a habit, not a project.** Editing a `.md` file under
  `src/content` is reflected immediately in `goribu dev`; a doc change is one file
  edit and a redeploy.

## Lesson log

Points where building the site fell out of the happy path, and whether each forced
a framework change.

1. **Markdown can't be a route file** (route scanner accepts only
   `.js/.jsx/.ts/.tsx`). Resolved at app level — content in `src/content`, thin
   `.jsx` routes import the compiled `.md`. **No framework change**; the boundary
   held and composition was enough.
2. **No per-page `<head>` / `<title>`.** The `Document` contract passes only
   `children`, so the site runs with a single site-wide `<title>`. A docs site
   genuinely wants per-page titles (browser tabs, sharing). **No framework change
   now** — this is owned by the metadata API in Block 5, and is recorded as a
   residual below. Front matter already carries `title`/`description`, so wiring it
   through is trivial once the head API exists.
3. **Markdown through the production static-output build** worked first time. **No
   framework change**; noted as confirmation, not a problem.

Net: **the block closed without any framework change.** Nothing that fell out of
the happy path forced one; the single real gap (per-page metadata) is already
owned by a later block.

## Known residuals

- **Per-page metadata is Block 5.** The site uses one site-wide `<title>`; per-page
  titles and `<head>` content wait for the metadata API. Front matter captures the
  data already.
- **No hydration.** Every page is HTML-only and ships the inert `client-entry.js`
  placeholder; the "static route that also hydrates" corner of the two axes opens
  when the client runtime lands. The JavaScript docs page will be updated then.
- **No code-block highlighting, no search, no CMS.** Deliberately out of scope for
  this block; the plan defers search explicitly.
- **The Markdown plugin is site-local.** It is not a framework feature and is not
  meant to be reused until a second app needs it.
