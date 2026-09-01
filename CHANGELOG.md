# Changelog

All notable changes to Goribu are recorded here. This file is maintained as
changes land, not retrofitted at release time.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
Goribu follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The
first tagged release will be `0.1.0-alpha`; until then everything lives under
Unreleased.

## [Unreleased]

### Added

- `goribu` CLI, the framework's front door, with `dev`, `build`, and `deploy`
  commands.
- `goribu dev`: local development server (Vite plus workerd) serving the real
  Worker with HMR.
- `goribu build`: one production build emitting the Worker bundle and the client
  bundle.
- `goribu deploy`: deploy to Cloudflare (Worker plus static assets).
- `defineConfig()` from `goribu/server`: the application configuration channel,
  starting with the deploy fields `name`, `compatibilityDate`, and
  `compatibilityFlags`.
- Streaming server-side rendering of a React page through
  `renderToReadableStream`.
- Wrangler configuration synthesized from `goribu.config.js`, so an app never
  hand-writes a Wrangler file.
- File-based routing: files under `src/routes/` map to URLs, with `[param]`
  dynamic segments, static-before-dynamic precedence, and build-time errors for
  conflicting routes. Catch-all and optional segments are deliberately not
  supported yet.
- Streaming server-side rendering for every matched route through a document
  shell, with a customizable `src/routes/_document.jsx` and a built-in default.
- `_404`: a custom or built-in not-found page, rendered with a `404` status.
- Automatic method responses from routing alone — `HEAD`, `OPTIONS` (`204`), and
  `405 Method Not Allowed`, each with an `Allow` header.
- Trailing-slash canonicalization: a single `308` redirect to the slash-free
  URL, applied consistently to static and dynamic routes.
- Static asset serving from `public/` via the `ASSETS` binding, with a generated
  `_headers` caching Goribu's fingerprinted client build (`/_goribu/assets/*`)
  immutably.
- Build-time static output: routes whose first response needs no Worker are
  rendered at build time by running the emitted Worker in workerd, and served
  from Static Assets without invoking the Worker. Candidates that cannot be made
  static are downgraded with a named reason.
