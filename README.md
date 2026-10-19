<div align="center">

<a href="https://goribu.dev"><img src="https://goribu.dev/og-image.png" alt="Goribu: the React framework for Cloudflare Workers" width="720"></a>

[![npm](https://img.shields.io/npm/v/goribu?color=f38020)](https://www.npmjs.com/package/goribu)
[![license](https://img.shields.io/npm/l/goribu?color=blue)](LICENSE)
![status](https://img.shields.io/badge/status-pre--1.0-yellow)

[Documentation](https://goribu.dev/docs) ·
[Getting started](https://goribu.dev/docs/installation) ·
[Changelog](CHANGELOG.md)

</div>

---

```sh
pnpm create goribu@latest my-app
```

Goribu is a full-stack React framework for Cloudflare Workers. Workers is a
capable, low-cost platform, but coming from Next.js, Express or Remix means
learning a lot of new conventions. Goribu makes it familiar. React pages and their server handlers live in one file, Cloudflare
resources are declared in config, and one command deploys.

It's made for humans and coding agents alike. The API is small and has one
canonical way to do each thing, so the code your agent writes is code you can
read and review.

## How it works

Every request takes one of three forms. You never wire them up; the route
decides.

| | Request | What happens |
| --- | --- | --- |
| **First visit** | `GET /posts/42` | The Worker runs your handler and streams the HTML. |
| **Navigation** | link to `/posts/43` | The browser fetches only the page data as JSON and swaps in the next page. |
| **Static route** | `GET /about` | HTML and page data come straight from Cloudflare's CDN. The Worker never runs. |

A page with no request-time work is built to static HTML automatically, with
nothing to turn on. You get server rendering for the first load and SEO, then
app-like navigation, with no client-side caches to keep in sync, skeleton
screens or React Server Components.

## A route in one file

A route can export a page, HTTP handlers, or both. Here a `GET` handler loads a
post from D1 and renders the page with it:

```jsx
// src/routes/posts/[id].jsx
export async function GET(req, res) {
  const post = await req.d1`
    SELECT title, body FROM posts WHERE id = ${req.params.id}
  `.get();
  if (post === null) return res.notFound();
  return res.render({ post });
}

export default function Post({ post }) {
  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.body}</p>
    </article>
  );
}
```

Interpolated values become bound parameters, so they never become part of the
SQL text.

Forms post to the same file's handlers. `<Form>` tracks pending state, shows
validation errors, and focuses the first invalid field:

```jsx
import { Form } from "goribu";

export default function Subscribe() {
  return (
    <Form method="post">
      {({ pending, errors, data }) => (
        <>
          <input name="email" type="email" />
          {errors?.email && <p>{errors.email}</p>}
          <button disabled={pending}>Subscribe</button>
          {data?.subscribed && <p>Thanks for subscribing.</p>}
        </>
      )}
    </Form>
  );
}

export async function POST(req, res) {
  const { email } = await req.body();
  if (typeof email !== "string" || !email.trim()) {
    return res.invalid({ email: "Enter an email." });
  }
  await subscribe(req, email);
  return res.json({ subscribed: true });
}
```

## Made for coding agents

Goribu started as a framework for writing code by hand. The same things make
it work well with Claude Code, Codex and other agents:

- **Small API.** There are fewer conventions to learn or get wrong.
- **One canonical way to do each thing.** What you would write is what your
  agent writes, so the code stays easy to review.
- **Resources from code.** Declare D1, KV or R2 in `goribu.config.js` and the
  next deploy creates them, without the dashboard. An agent can do that too.
- **Ready from the start.** New apps include an `AGENTS.md` that explains the
  conventions.

## What's included

- **Routing:** file-based routes with dynamic segments, middleware, and custom
  `404` and `500` pages.
- **Rendering:** streamed SSR, hydration, and per-route metadata.
- **Navigation:** client navigation with `<Link>`, `<NavLink>` and `navigate()`,
  plus prefetch and scroll restoration.
- **Forms:** GET, POST, PUT, PATCH and DELETE through `<Form>`. Cross-origin form
  posts are refused by default.
- **Data:** D1 with read replicas, or Postgres through Hyperdrive, so your
  database can stay at Neon, PlanetScale or your own server. Also SQL
  migrations, KV, and request caching that needs no setup.
- **Files:** R2 storage with signed URLs and direct browser uploads.
- **The rest of Cloudflare:** Workers AI, service bindings and other native
  Wrangler fields go in a `wrangler` block.
- **Deploys:** `pnpm run deploy` builds the app, creates missing databases, KV
  namespaces and buckets, applies migrations, and can connect your domain.
- **TypeScript:** the starter uses TypeScript and Tailwind. Pass `--js` for
  JavaScript.
- **Vite:** fast development with hot updates, and the Vite plugin ecosystem.
- **Errors that teach:** framework errors say what went wrong and how to fix
  it. Production error pages show an ID you can trace in your logs next to the
  CF-Ray.

## Quick start

You need Node.js 22+ and pnpm. A Cloudflare account is only needed to deploy.

```sh
pnpm create goribu@latest my-app
cd my-app
pnpm install
pnpm dev
```

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start Vite and workerd with hot updates. |
| `pnpm build` | Build the Worker, browser assets and static HTML. |
| `pnpm typecheck` | Type-check a TypeScript app. |
| `pnpm check` | Show the production resource and migration plan without changing anything. |
| `pnpm exec goribu cloudflare-login` | Log in to Cloudflare through Wrangler. |
| `pnpm run deploy` | Build, create resources, apply migrations and deploy. |
| `pnpm exec goribu tail` | Stream live production logs. |

Use `pnpm run deploy`: `pnpm deploy` is a different pnpm command.

## Status

Goribu is before 1.0 and maintained by one person. It's usable today, but APIs
can still change between minor versions; the [changelog](CHANGELOG.md) marks
breaking changes and the [release guide](docs/releasing.md) has upgrade notes.

## Contributing

Pull requests aren't open yet, but bug reports are welcome as
[issues](https://github.com/anges244/goribu/issues).
[CONTRIBUTING.md](CONTRIBUTING.md) covers the workspace and tests. Report
security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Aggelos Gesoulis
