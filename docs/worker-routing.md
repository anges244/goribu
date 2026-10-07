# Worker routing

A deployed Goribu application runs the Worker only for URLs that can need it.
Every other request is answered by Cloudflare Static Assets, including the
`404` for URLs that match nothing. Scanners probing `/wp-login.php` or `/.env`
receive your not-found page without invoking the Worker or your code.

There is nothing to configure. `goribu build` derives the routing from your
route tree and writes it into the Worker configuration it emits.

## Which requests reach the Worker

After static output is built, the build plans one rule per Worker route:

| Route | Requests sent to the Worker |
| --- | --- |
| `src/routes/subscribe.js` | `/subscribe` and `/subscribe/` |
| `src/routes/posts/[id].jsx` | everything below `/posts/`, such as `/posts/42` and `/posts/42/edit` |
| Goribu's own endpoints | client navigation (`/_goribu/worker-nav`), and R2 file and upload links when R2 is configured |

A static route is not in the list: its prerendered HTML is served directly.
A static page that could not be prerendered stays on the Worker and gets a
rule like any other Worker route.

Two consequences follow from how Cloudflare matches these rules:

- **A parameter covers everything below it.** Cloudflare's `*` crosses
  slashes, so `/posts/*` also admits `/posts/42/wp-login.php`. The Worker
  still matches routes exactly and answers such URLs with your `_404` page.
  A static prefix before a parameter keeps the Worker's exposure narrow.
- **Client navigation can always reach the Worker.**
  `/_goribu/worker-nav?to=/anything` invokes the Worker for any target, and it
  answers a target that matches no route with a reload instruction.

Within those rules, every route exists exactly as in development. Routing only
decides who answers requests that no Worker route could ever match.

## The not-found page in production

The build renders your `_404` page, or the built-in one, once through the built
Worker and saves it as `404.html`. Static Assets serves that file with status
`404` for every URL outside the Worker rules. Its HTML is shared by every
visitor, so it is built without request data:

- Its `meta` function receives `{ props: {}, url }` with the URL `/404`, not
  the URL that was missed.
- It has no current location, so `NavLink` marks no link active.
- It carries no CSP nonce, cookies, or `responseHeaders` headers, like any other
  static page.

A miss that does reach the Worker, such as `/posts/42/missing`, still renders
`_404` per request with the missed URL. `res.notFound(props)` from a handler is
always rendered by the Worker with those props.

## Build failures

Unknown URLs would invoke the Worker if the not-found page were missing, so the
build fails instead of deploying without it:

- **The not-found page cannot render without a request.** The build reports the
  page's error. A component that throws, including inside a `Suspense`
  boundary, fails the build. Keep request-specific not-found pages in handlers
  with `res.notFound(props)`.
- **Another `404.html` exists.** Static Assets serves the nearest `404.html` for
  a miss, so a file named `404.html` in `public/` or a static route named `404`,
  at any depth, would replace Goribu's page. Customize the page in
  `src/routes/_404.jsx` instead.
- **Static Assets does not serve the page.** After writing the configuration,
  the build requests an unknown URL through Cloudflare's local asset router. A
  `public/.assetsignore` pattern that excludes `404.html` fails here.
- **Too many rules.** Cloudflare allows 100 rules of at most 100 characters.
  Static files that sit below a Worker rule, such as `public/posts/feed.xml`
  under `/posts/*`, need an exclusion rule each. The build fails rather than
  broadening routing; group dynamic routes under shared prefixes.

## Root parameters

A route such as `src/routes/[slug].jsx` matches any single-segment URL, so every
unknown URL is a possible match and must reach the Worker. Goribu keeps
Cloudflare's default routing for such applications: existing files are served
from Static Assets, and every other request runs the Worker, which renders
`_404` per request. The build prints a warning naming the route. Move the
parameter below a static prefix, such as `src/routes/p/[slug].jsx`, to get
selective routing.

## Differences from development

`goribu dev` sends every request to the Worker, as it does for static pages.
Real routes and unknown `GET` or `HEAD` URLs answer the same way in both. Three
asset-layer details differ in production:

- An unknown URL requested with a method other than `GET` or `HEAD` answers
  `405`, not `404`.
- A URL with repeated trailing slashes, such as `/subscribe//`, takes one extra
  redirect before reaching `/subscribe`.
- The not-found page has no request location or `responseHeaders` headers, as
  described above.

## See also

- [static-routes.md](./static-routes.md) — which pages are prerendered.
- [routing.md](./routing.md) — how URLs map to routes.
- [deploy.md](./deploy.md) — deploying the built application.
- [decisions.md](./decisions.md) — the routing decisions and their evidence.
