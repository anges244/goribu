# Forms

`<Form>` submits to a route's matching HTTP handler. The handler owns the request and response; the component owns pending state, validation errors, and the last successful JSON result. GET and POST forms work natively before hydration. PUT, PATCH, and DELETE forms become usable after hydration.

```jsx
import { Form } from "goribu";

export default function SubscribePage() {
  return (
    <Form method="post">
      {({ pending, errors, data }) => (
        <>
          <input name="email" type="email" />
          {errors?.email ? <p>{errors.email}</p> : null}
          <button disabled={pending}>Subscribe</button>
          {data?.subscribed ? <p>Subscribed.</p> : null}
        </>
      )}
    </Form>
  );
}

export async function POST(req, res) {
  const { email } = await req.body();
  if (typeof email !== "string" || !email.trim()) return res.invalid({ email: "Enter an email." });
  await subscribe(req, email);
  return res.json({ subscribed: true });
}
```

`method` is required and accepts `get`, `post`, `put`, `patch`, or `delete`, case-insensitively. `action` defaults to the browser's current URL at submit time, so it remains correct when a component survives client navigation. The method selects the action route's matching handler: `<Form method="patch">` sends a real PATCH request to its `PATCH` export. There is no hidden method field or POST tunneling. HEAD and OPTIONS remain available as route handlers, but are not Form methods.

A page with mutation handlers is served by the Worker automatically, so submissions reach those handlers in production. See [Static routes](./static-routes.md) for separating a static page from its action route.

## Handler outcomes

Enhanced POST, PUT, PATCH, and DELETE submissions understand the same four response intents:

| Handler result | Browser behavior |
| --- | --- |
| `res.json(data)` | Stay on the page and expose `data` to the render prop. |
| `res.invalid(errors)` | Stay, expose `errors`, mark fields, and focus the first invalid control. |
| `res.redirect(url)` | Navigate to the destination without replaying the mutation. |
| `res.render(props)` | Re-render this route in place with fresh props and metadata. |

Choose based on what the user should see next. A non-2xx JSON result produces a
form-level failure while preserving the response data for `onResult`.

## Validation

`res.invalid()` returns `422`. Object keys correspond to form control names:

```js
return res.invalid({
  email: "Enter a valid email.",
  root: "The account could not be updated.",
});
```

The string form becomes `errors.root`:

```js
return res.invalid("That invitation has expired.");
```

Goribu applies `aria-invalid="true"` to matching controls, focuses the first in
DOM order, and clears only attributes it applied. The application renders error
text and owns `aria-describedby`. In development, unmatched error keys and a
control named `root` produce console warnings.

Always validate on the server. Native constraint validation is an ergonomic
first pass, not an authorization or integrity boundary.

## GET and mutation methods

An enhanced GET converts successful non-file controls to a query string and
uses normal client navigation:

```jsx
<Form method="get" action="/search" replace>
  {({ pending }) => (
    <>
      <input name="q" />
      <button disabled={pending}>{pending ? "Searching..." : "Search"}</button>
    </>
  )}
</Form>
```

The fields replace the action's existing query. File values cannot be encoded in
the URL and are omitted, with a development warning. GET has no response data or
validation state because it navigates to another page representation.

POST, PUT, PATCH, and DELETE send `application/x-www-form-urlencoded` unless the form has an enabled named file input, in which case they send `multipart/form-data`. Read the body with the same `req.body()` API for every method.

Successful controls, external controls associated with the form, and the clicked submitter's name/value are preserved. Submitter `formAction`, `formMethod`, and `formTarget` overrides are resolved at submit time. Button `formMethod` accepts only `get` and `post`; put extended methods on `<Form method>` itself so Goribu can prevent submission before hydration. An unsupported override cancels submission and throws a repair instruction after hydration.

For example, this route accepts PATCH directly:

```jsx
import { Form } from "goribu";

export default function NamePage() {
  return (
    <Form method="patch">
      {({ data }) => (
        <>
          <input name="name" />
          <button>Send name</button>
          <p>{data?.name}</p>
        </>
      )}
    </Form>
  );
}

export async function PATCH(req, res) {
  const { name } = await req.body();
  return res.json({ name });
}
```

`encType` is not configurable. Goribu renders native forms as multipart so file
and submitter behavior remains safe before hydration, while enhanced submission
selects the narrowest correct encoding.

`await req.body()` returns an object for both form encodings: read `body.name`
for a text field or `body.file` for an upload. Uploaded values are `File` objects;
repeated names become arrays, and missing fields are absent. Validate the values
you expect; there is no need to check for `FormData`. See
[Reading the body](./handlers.md#reading-the-body) for migration details.

## Same-page render safety

An enhanced form can apply `res.render(props)` in place only when the action
pathname matches the page already displayed. A valid same-origin `Referer` that
identifies a different pathname still causes an error with a repair instruction:
rendering another route without changing the address bar would leave the page
and URL inconsistent. The browser recovers through a document GET.

The browser proves the displayed page through a same-origin `Referer`. Query
strings may differ and the displayed query is retained for metadata. A missing,
malformed, or non-same-origin Referer instead produces an explicit document-reload
response, without a framework-generated 500. Cookies and headers from the handler
are preserved. The browser loads the action URL with GET, preserving its query
and removing its fragment so the browser cannot treat recovery as an in-page
anchor change. It never replays the mutation. Before leaving the page, the
fallback does not apply Form's `reset` or invent a submission failure, and it yields to a newer
navigation, including an external `navigate()` from `onResult`.

That GET uses the route's normal page data. Props returned only by the mutation,
such as an unsaved preview, are not carried across the reload.

Return `res.redirect()` when the user should move to another route, or
`res.json()` when the current component should handle returned data without
re-rendering the page.

## State and completion

Render-prop children receive:

```js
{ pending, errors, data }
```

`pending` becomes true synchronously when enhancement accepts a submission.
Duplicate submissions from the same form are blocked until completion. Old
errors clear when a new submission starts; previous data remains during the
request to avoid flicker, then the completed outcome makes `data` and `errors`
describe that same submission.

`reset` clears controls after a successful JSON or same-page render result, but
not after invalid state or a redirect. A forwarded ref receives the underlying
form when conditional reset behavior is needed.

`onSubmit` runs before Goribu and may cancel enhancement with `preventDefault()`.
`onResult` runs after local state and any in-place page render commit, but before
redirect navigation. It receives the final success/failure result and, for mutation responses, the underlying `Response`.

Unmounting aborts the active request. A newer navigation also invalidates an
older form completion, so stale data cannot overwrite the page the user has
already reached.
Once a GET or redirect destination has been accepted into history, navigation
finishes its render and scrolling even if replacing the page unmounts the
submitting Form. A newer navigation still takes precedence.

## Native behavior before hydration

GET and POST render ordinary multipart forms before the submit handler attaches. Results retain their ordinary server representation:

- `res.render()` streams HTML;
- `res.redirect()` is a wire redirect;
- `res.json()` and `res.invalid()` are full-page JSON responses.

PUT, PATCH, and DELETE require hydration to submit. Until then, their contents are visible but inert and there is no native form to submit, including from external controls associated by `form="id"`. Without JavaScript, these forms remain inactive. The form ref becomes available after hydration; use classes to style the wrapper before then.

Enhanced validation and in-place rendering require JavaScript by design. If a
submit is intercepted before the navigation runtime finishes installing, Goribu
fails closed to a document load rather than committing partial state.

GET/POST submissions to cross-origin or non-HTTP actions, or non-`_self` targets, remain native. PUT/PATCH/DELETE submissions require a same-origin HTTP(S) action and an omitted or `_self` target, including submitter overrides. Goribu cancels unsupported submissions and throws with a repair instruction; it never substitutes GET or POST for an extended method.

Malformed claimed protocol responses recover through a document GET; the mutation is never automatically repeated.

See [navigation.md](./navigation.md) for navigation behavior and
[handlers.md](./handlers.md) for the request/response surface.
