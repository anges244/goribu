---
title: Forms
description: Native GET and POST forms enhanced with pending state, validation, redirects, and same-page rendering.
---

`<Form>` is a real form before hydration and a stateful route submission after
it. It accepts only `get` and `post`; `method` is required and `action` defaults
to the current browser URL at submit time.

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

## Four POST outcomes

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

GET converts successful non-file controls into a query string and uses client
navigation. POST uses URL encoding unless an enabled named file input requires
multipart. The clicked submit button and native `formaction`, `formmethod`, and
`formtarget` overrides are honored, but unsupported methods fail closed.

`pending` starts synchronously and duplicate submits are blocked. Errors clear
when a new request starts; previous data remains while pending, then `data` and
`errors` describe the same completed result. `reset` clears fields after a
successful JSON or same-page render result. `onSubmit` may cancel enhancement;
`onResult` observes completion before redirect navigation.

Cross-origin actions, non-HTTP actions, and non-`_self` targets remain native. A
newer navigation or unmount invalidates an older submission so it cannot replace
the current page.

## Before hydration

The server-rendered element is an ordinary multipart form. Before enhancement:

- `res.render()` returns HTML;
- `res.redirect()` is a normal wire redirect;
- `res.json()` and `res.invalid()` are full-page JSON responses.

Enhanced validation and in-place rendering require JavaScript by design. A
submission caught before navigation finishes installing fails closed to a
document load rather than partial state.

The site's [feedback page](/feedback) exercises validation, same-page preview,
cookie transport, and redirect navigation.

**Next:** [D1](/docs/d1).
