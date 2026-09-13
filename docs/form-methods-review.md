# Form methods — review

`<Form method="put">`, `<Form method="patch">`, and `<Form method="delete">` now send their real HTTP verbs to matching route handlers. They use the same pending state, validation, JSON data, rendering, redirects, and request encoding as POST. Pages with mutation handlers now stay on the Worker automatically, fixing production submissions that Static Assets previously answered with 405.

## Changes

- **Client:** accept five methods, preserve GET navigation, and keep native GET/POST submission. Extended-method forms render an inert `div` until hydration creates the actual form. This also prevents external controls using `form="id"` from submitting early. The forwarded form ref becomes available after hydration; class-based styling applies to both elements.
- **Submission rules:** extended methods belong on `<Form>`. Button `formMethod` remains GET/POST only, as requested. Extended submissions require a same-origin HTTP(S) action and an omitted or `_self` target, including button destination overrides. Rejected submissions and exceptions from their `onSubmit` callbacks cannot trigger native fallback.
- **Worker:** POST, PUT, PATCH, and DELETE all negotiate the existing form protocol through `Accept`. They retain response status, application headers, cookies, `no-store`, and `Vary: Accept`. Ordinary requests retain their ordinary response representation. Redirects and recovery never replay the mutation.
- **Types:** `FormMethod` includes the three new methods; positive and negative compiler fixtures match the runtime API. HEAD and OPTIONS remain route handlers, outside the Form API.
- **Documentation:** the development and site Forms guides, both TypeScript references, navigation guide, changelog, and appended design decision describe the new contract. New Forms examples are JavaScript/JSX.
- **Fixture:** `/forms` exercises all four mutation handlers and response outcomes. Integration tests use real Vite/Worker requests, including uploads, cookies, response negotiation, and render safety.

## Production routing correction

The new fixture exposed an existing production bug: an implicit-GET page with mutation handlers was automatically prerendered. Cloudflare Static Assets then shadowed the route and returned 405 for submissions to the same URL. A direct local production HTTP probe and Chrome native POST reproduced this. Development and direct `getWorker().fetch()` checks bypass that asset-routing boundary.

The maintainer approved keeping these routes on the Worker automatically. Manifest generation now makes pages with no HTTP handlers automatic static candidates and rejects `prerender = true` when non-GET handlers exist. This covers POST/PUT/PATCH/DELETE and explicit HEAD/OPTIONS handlers, which assets would also bypass. Explicit GET-only prerendering remains supported. The manifest already feeds both static output planning and Worker nonce handling, so the fix does not add a second eligibility rule.

A static page can submit to a separate action URL. Colocated pages and mutation handlers now work without a manual `prerender = false`, but their GET requests also invoke the Worker. This behavior change is documented in both static-route guides and appended to the decision log. The site routing guide also no longer claims that handler exports are unsupported.

A production regression checks real HTTP requests through the local production listener, for ordinary and negotiated POST/PUT/PATCH/DELETE, and checks that the forms page is absent from static output.

## Validation

- `pnpm test --maxWorkers=1` passed: **87 files / 680 tests**. This includes public types, browser behavior tests, real Worker integration, production builds, and production HTTP routing.
- Focused checks passed for client submissions, hydration, public types, Worker response negotiation, and routing. The final routing check passed 3 files / 30 tests, including real production HTTP submissions.
- Chrome development and final production checks passed with zero browser errors: JavaScript disabled, entry loading paused, native POST, exact PUT/PATCH/DELETE requests, JSON results, validation/focus, same-page rendering, redirects, and no mutation replay. The final production check uses the ordinary fixture with no prerender override.

`git diff --check` passed. Verification servers and isolated browsers were closed. Nothing has been deployed; browser verification used local development and production Workers.

The initial production browser check reproduced the static-asset 405 bug. An earlier full suite failed one outdated static-page-count assertion; neither is counted as a passing final run.

## Lessons

A browser cannot express PUT/PATCH/DELETE through an HTML form. Restricting the new methods to the Form component lets Goribu prevent early submissions without taking native GET/POST behavior away from existing forms. Rendering no native form before hydration also protects external submit buttons, which disabling only descendant controls would miss.

An integration check must use the production HTTP listener when testing Static Assets routing. Calling the Worker directly proves dispatch but skips the platform layer that decides whether dispatch happens at all.

No installation, commit, deployment, or publication has been performed. The implementation remains uncommitted for maintainer review.

Ready for maintainer review at a coherent, passing commit boundary. Suggested commit message:

```text
feat: support Form mutation methods and preserve handler routing
```
