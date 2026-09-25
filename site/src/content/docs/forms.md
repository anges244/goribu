---
title: Forms
description: Forms that submit to HTTP method handlers, with pending state, validation, redirects, and same-page rendering.
---

`<Form>` submits to a route's matching HTTP handler. Its required `method` accepts `get`, `post`, `put`, `patch`, or `delete`, case-insensitively. `action` defaults to the current browser URL at submit time.

```jsx
import { Form } from "goribu";

export default function FeedbackPage() {
  return (
    <Form method="post">
      {({ pending, errors, data }) => (
        <>
          <textarea name="message" />
          {errors?.message ? <p>{errors.message}</p> : null}
          <button disabled={pending}>Send</button>
          {data?.sent ? <p>Sent.</p> : null}
        </>
      )}
    </Form>
  );
}

export async function POST(req, res) {
  const { message } = await req.body();
  if (typeof message !== "string" || !message.trim()) return res.invalid({ message: "Enter a message." });
  return res.json({ sent: true });
}
```

## Four mutation outcomes

POST, PUT, PATCH, and DELETE share these outcomes. For example, `<Form method="patch">` sends a real PATCH request to the action route's `PATCH` handler, where `await req.body()` reads the submitted fields.

A page with mutation handlers is served by the Worker automatically, so submissions reach those handlers in production.

| Handler result | Browser behavior |
|---|---|
| `res.json(data)` | Stay and expose `data`. |
| `res.invalid(errors)` | Stay, expose `errors`, mark fields, and focus the first invalid control. |
| `res.redirect(url)` | Navigate to the destination. |
| `res.render(props)` | Re-render this route in place with fresh props and metadata. |

Error object keys match control names; a string becomes `errors.root`. The
application renders error text and owns `aria-describedby`. Goribu applies and
clears its own `aria-invalid` markers.

`res.render()` can update the page in place only when a same-origin `Referer`
identifies the action pathname; query strings may differ. A missing or unusable
Referer requests a full document GET of the action URL without generating a 500.
Cookies and handler headers are preserved, and the mutation is never repeated.
Recovery preserves the query and removes the fragment to force a document request.
A newer navigation, including an external `navigate()` from `onResult`, takes
precedence over recovery.
The GET uses normal page data, so mutation-only props such as an unsaved preview
do not survive the reload. A verified different pathname remains an error with
a repair instruction and document fallback.

If the page throws while committing a Form render response, the browser makes a
GET of the submitted action URL even if the response removes the Form before
a layout effect throws in the same commit. It preserves the action query and
`replace`, removes the fragment, and never replays
the mutation. The removed Form runs neither `reset` nor `onResult`. Cancellation
before the response starts committing, disposal, and newer navigation still
take precedence. Mutation-only props are lost, and the GET may return an error
page; there is no automatic retry.
Errors after a completed render retain normal React error handling.

`await req.body()` returns an object for both form encodings: read `body.name`
for a text field or `body.file` for an upload. Uploaded values are `File` objects;
repeated names become arrays, and missing fields are absent. Validate the values
you expect; there is no need to check for `FormData`. See
[Reading the body](/docs/handlers) for migration details.

## Submission behavior

GET converts successful non-file controls into a query string and uses client navigation. POST, PUT, PATCH, and DELETE use URL encoding unless an enabled named file input requires multipart. The clicked submit button's name/value and its `formAction`, `formMethod`, and `formTarget` overrides are honored. Button `formMethod` accepts only `get` and `post`; set PUT, PATCH, or DELETE on `<Form method>` itself. Unsupported overrides cancel submission with an error after hydration.

`pending` starts synchronously and duplicate submits are blocked. Errors clear
when a new request starts; previous data remains while pending, then `data` and
`errors` describe the same completed result. `reset` clears fields after a
successful JSON or same-page render result. `onSubmit` may cancel enhancement;
`onResult` observes completion before redirect navigation.

GET/POST submissions to cross-origin or non-HTTP actions, or non-`_self` targets, remain native. PUT/PATCH/DELETE require a same-origin HTTP(S) action and an omitted or `_self` target; unsupported destinations cancel submission with a repair instruction. A newer navigation or unmount invalidates an older submission so it cannot replace the current page.

Once a GET or redirect destination has been accepted into history, navigation
finishes its render and scrolling even if replacing the page unmounts the
submitting Form. A newer navigation still takes precedence.
For an in-place render response, the controller owns completion and error
recovery once React starts committing it, before the response can remove the
Form. Removing the Form while the response is still loading or suspended
cancels completion as usual; newer navigation and disposal can cancel throughout.

## Before hydration

GET and POST render ordinary multipart forms. Before enhancement:

- `res.render()` returns HTML;
- `res.redirect()` is a normal wire redirect;
- `res.json()` and `res.invalid()` are full-page JSON responses.

PUT, PATCH, and DELETE forms wait for hydration: their contents are visible but inactive until JavaScript attaches. They never fall back to GET or POST. Without JavaScript, they remain inactive.

Enhanced validation and in-place rendering require JavaScript by design. A
submission caught before navigation finishes installing fails closed to a
document load rather than partial state.

The site's [feedback page](/feedback) exercises validation, same-page preview,
cookie transport, and redirect navigation.

**Next:** [D1](/docs/d1).
