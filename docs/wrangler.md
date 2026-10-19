# Wrangler configuration

Goribu generates `goribu.wrangler.jsonc` from `goribu.config.js`. For Cloudflare
features Goribu does not manage, such as Workers AI, service bindings, Vectorize,
or queue producers, add Wrangler's own fields under `wrangler`:

```js
import { defineConfig } from "goribu/server";

export default defineConfig({
  name: "my-app",
  compatibilityDate: "2026-09-04",
  wrangler: {
    ai: { binding: "AI" },
    services: [{ binding: "SEARCH", service: "search-worker" }],
    vars: { API_HOST: "api.example.com" },
    observability: { enabled: true, head_sampling_rate: 0.1 },
  },
});
```

The fields use Wrangler's names and shapes exactly, as described in
[Cloudflare's configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/).
Goribu adds them to the generated file after its own fields, and handlers read
the bindings from `req.env`:

```js
export async function POST(req, res) {
  const { prompt } = await req.body();
  const answer = await req.env.AI.run("@cf/meta/llama-3.2-1b-instruct", { prompt });
  return res.json(answer);
}
```

## What Goribu checks

`goribu dev` and `goribu build` check the block each time they write the
generated file. Apps without a `wrangler` block skip these checks.

1. **JSON only.** `defineConfig` takes a deeply frozen copy of the block and
   rejects anything JSON would drop or change: `undefined`, functions,
   `Infinity` or `NaN`, `Date` and other non-plain objects, sparse arrays,
   named array properties, cycles, and getters. The error names the path, such
   as `wrangler.vars.STARTED_AT`.
2. **Fields Goribu owns.** A reserved field, listed below, fails with the reason
   and where to configure it instead.
3. **Wrangler's schema.** The whole generated config is checked against the
   schema that ships with Goribu's Wrangler, so a misspelled field fails rather
   than being ignored:

   ```text
   [Goribu] wrangler.observability contains unknown field "head_samplng_rate". Check its spelling against Wrangler's configuration reference. This Goribu installation uses Wrangler 4.127.1; if the field needs a newer Wrangler, update goribu.
   ```

4. **Reserved binding names**, then **Wrangler's own reader**, which catches
   problems such as two bindings with the same name.

Wrangler is a dependency of Goribu and is pinned to one version, so the fields
you can use are the ones that Wrangler supports. Cloudflare's documentation can
describe newer fields; those need a Goribu release with a newer Wrangler.

## Reserved fields and names

These fields are rejected inside `wrangler`:

| Fields | Why |
|---|---|
| `name`, `main`, `compatibility_date`, `compatibility_flags`, `workers_dev`, `preview_urls`, `assets`, `account_id` | Goribu writes them from `goribu.config.js`. `CLOUDFLARE_ACCOUNT_ID` chooses the account. |
| `d1_databases`, `kv_namespaces`, `r2_buckets`, `hyperdrive` | Goribu manages these bindings through `database`, `kv`, and `r2`. Additional databases, namespaces, and buckets are not supported yet. |
| `routes`, `route`, `env`, `previews`, `compliance_region`, `pages_build_output_dir` | Goribu deploys one production Worker and attaches `domain` itself. |
| `dev`, `build`, `alias`, `define`, `minify`, `rules`, `no_bundle`, `base_dir`, `find_additional_modules`, `preserve_file_names`, `site`, `tsconfig` | Vite and `goribu dev` own bundling and the dev server; configure Vite in `vite.config.js`. |
| `triggers`, `migrations`, `exports`, `containers`, `cloudchamber`, and `queues.consumers` | They need Worker handlers or exported classes, which Goribu does not support yet. |
| `unsafe`, `unsafe_hello_world` | They bypass Wrangler's validation. |

Durable Object and Workflow bindings must name the Worker that defines the class
with `script_name`. A class in your own Worker needs exports Goribu does not
offer yet:

```js
wrangler: {
  durable_objects: { bindings: [{ name: "COUNTER", class_name: "Counter", script_name: "counter-worker" }] },
  workflows: [{ binding: "ONBOARDING", name: "onboarding", class_name: "Onboarding", script_name: "onboarding-worker" }],
}
```

The binding names `ASSETS`, `DB`, `KV`, `R2`, `R2_PRIVATE`, `POSTGRES`, and
`POSTGRES_CACHED`, and any name starting with `GORIBU_` or `__GORIBU_`, are
reserved in every binding kind and in `vars`, even when the matching feature is
off. Turning on KV later can then never collide with your own `KV`.

## Vars and secrets

`wrangler.vars` holds plain configuration values. They are written into the
deploy config and are part of the Worker bundle, because the Worker imports
`goribu.config.js`. Keep secrets in `.env.production` instead; see
[environment variables](environment-variables.md). In development, a matching
key in `.env` or `.dev.vars` overrides a var.

## Placement

By default the Worker runs in the Cloudflare location nearest each visitor.
When a request spends most of its time on round trips to one backend, such as a
database, `placement` runs the Worker near that backend instead:

```js
wrangler: {
  placement: { mode: "smart" },
},
```

Smart Placement watches the Worker's traffic and moves it only once that shows a
closer location is faster. To choose the location yourself, use
`{ region: "aws:us-east-1" }` for a cloud region, `{ host: "db.example.com:5432" }`
for a TCP service, or `{ hostname: "api.example.com" }` for an HTTP service. See
Cloudflare's [placement documentation](https://developers.cloudflare.com/workers/configuration/placement/).

Placement moves only requests that reach the Worker. Static pages are still
served from Static Assets near the visitor. `goribu dev` runs locally, where
placement has no effect.

## Development

Some bindings never run locally. Wrangler sends Workers AI (and AI Search,
Media, Artifacts, Flagship, VPC, web search, and agent memory bindings) to
Cloudflare even during `goribu dev`, and also any binding you mark
`remote: true`. When one is declared, `goribu dev` first resolves the same
Cloudflare account as `goribu deploy` and pins the dev proxy to it. Without a
login, dev stops before starting:

```text
[Goribu] The wrangler binding AI runs on Cloudflare even in goribu dev, so dev needs Cloudflare access. Could not read Wrangler's authenticated Cloudflare credentials. ...
```

Run `pnpm exec goribu cloudflare-login`, or set `CLOUDFLARE_API_TOKEN` for
non-interactive use. With several accounts, set `CLOUDFLARE_ACCOUNT_ID`. Calls
made in dev reach the real service and are billed like production use.

Other bindings run locally. A service binding to a Worker that is not running
locally answers with an error until you start that Worker.

## Builds and static routes

`goribu build` needs no Cloudflare access. To render
[static routes](static-routes.md), it runs the built Worker locally without the
block's fields other than `vars`; the deploy config keeps all of them. A page
that reads only vars prerenders normally. A page that uses a withheld binding
while rendering cannot be static: an automatic candidate falls
back to rendering on the Worker, and a page with `export const prerender = true`
fails the build. Both messages give the error and the withheld bindings:

```text
[Goribu] Route "src/routes/summary.jsx" (/summary) is a prerender candidate but was not statically output: the Worker responded 500 (TypeError: Cannot read properties of undefined (reading 'run')); prerendering runs without the wrangler bindings AI, SEARCH, so a page that uses them must render on the Worker. It will render on the Worker at request time.
```

## Check and deploy

`goribu check` lists passed-through bindings separately from Goribu's own
resources. It does not inspect them, and `goribu deploy` neither creates nor
modifies them: an index, queue, or other Worker must already exist. Deploy
uploads the fields exactly as written.

## Not yet

Additional D1, KV, R2, or Hyperdrive resources, Worker handlers and class
exports (cron triggers, queue consumers, local Durable Objects and Workflows,
containers), and Wrangler environments are deliberately not
supported yet. A later release that reserves a field allowed today is a breaking
change and will include migration notes.
