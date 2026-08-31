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
