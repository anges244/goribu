# Forms

`<Form>` renders a real HTML form and enhances it after hydration. The server
handler owns the request and response; the component owns pending state,
validation errors, and the last successful JSON result.

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
  if (!email?.trim()) return res.invalid({ email: "Enter an email." });
  await subscribe(req, email);
  return res.json({ subscribed: true });
}
```

`method` is required and accepts only `get` or `post`. `action` defaults to the
browser's current URL at submit time, so it remains correct when a component
survives client navigation.

## Handler outcomes

An enhanced POST understands four response intents:

| Handler result | Browser behavior |
| --- | --- |
| `res.json(data)` | Stay on the page and expose `data` to the render prop. |
| `res.invalid(errors)` | Stay, expose `errors`, mark fields, and focus the first invalid control. |
| `res.redirect(url)` | Navigate to the destination without replaying the POST. |
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

## GET and POST

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

An enhanced POST sends `application/x-www-form-urlencoded` unless the form has
an enabled named file input, in which case it sends `multipart/form-data`.
Successful controls, external controls associated with the form, and the clicked
submitter's name/value are preserved. Submitter `formaction`, `formmethod`, and
`formtarget` overrides are resolved at submit time; an unsupported method still
fails closed.

`encType` is not configurable. Goribu renders native forms as multipart so file
and submitter behavior remains safe before hydration, while enhanced submission
selects the narrowest correct encoding.

## Same-page render safety

`res.render(props)` is allowed for an enhanced form only when the action pathname
matches the page already displayed. Rendering a different route without changing
the address bar would create an incoherent page/URL state, so Goribu throws with
a repair instruction instead.

The browser proves the displayed page through a same-origin `Referer`. Query
strings may differ and the displayed query is retained for metadata. If the
relationship cannot be proven, Goribu performs a full document GET after the
response; it never replays the mutation.

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
redirect navigation. It receives the final success/failure result and, for POST
responses, the underlying `Response`.

Unmounting aborts the active request. A newer navigation also invalidates an
older form completion, so stale data cannot overwrite the page the user has
already reached.

## Native behavior before hydration

Before the submit handler attaches, `<Form>` is an ordinary form with a resolved
action, `get` or `post` method, and multipart encoding. Results retain their
ordinary server representation:

- `res.render()` streams HTML;
- `res.redirect()` is a wire redirect;
- `res.json()` and `res.invalid()` are full-page JSON responses.

Enhanced validation and in-place rendering require JavaScript by design. If a
submit is intercepted before the navigation runtime finishes installing, Goribu
fails closed to a document load rather than committing partial state.

Cross-origin actions, non-HTTP actions, and non-`_self` targets remain native.
Malformed claimed protocol responses also recover through a document request;
the POST is never automatically repeated.

See [navigation.md](./navigation.md) for navigation behavior and
[handlers.md](./handlers.md) for the request/response surface.
