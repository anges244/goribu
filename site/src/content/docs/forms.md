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
  if (!message?.trim()) return res.invalid({ message: "Enter a message." });
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

`res.render()` is allowed only when the action pathname matches the page already
displayed. Query strings may differ. A verified same-origin `Referer` proves the
relationship; if it cannot be proven, Goribu recovers through a full document
GET and never repeats the mutation.

## Submission behavior

GET converts successful non-file controls into a query string and uses client navigation. POST, PUT, PATCH, and DELETE use URL encoding unless an enabled named file input requires multipart. The clicked submit button's name/value and its `formAction`, `formMethod`, and `formTarget` overrides are honored. Button `formMethod` accepts only `get` and `post`; set PUT, PATCH, or DELETE on `<Form method>` itself. Unsupported overrides cancel submission with an error after hydration.

`pending` starts synchronously and duplicate submits are blocked. Errors clear
when a new request starts; previous data remains while pending, then `data` and
`errors` describe the same completed result. `reset` clears fields after a
successful JSON or same-page render result. `onSubmit` may cancel enhancement;
`onResult` observes completion before redirect navigation.

GET/POST submissions to cross-origin or non-HTTP actions, or non-`_self` targets, remain native. PUT/PATCH/DELETE require a same-origin HTTP(S) action and an omitted or `_self` target; unsupported destinations cancel submission with a repair instruction. A newer navigation or unmount invalidates an older submission so it cannot replace the current page.

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
