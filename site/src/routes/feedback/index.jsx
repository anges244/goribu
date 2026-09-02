import { Form, Link } from "goribu";

// The request surface and the client runtime meeting on one route. The page is a
// hydrated <Form>; its POST handler drives all three enhanced outcomes:
//   - an empty message returns res.invalid(), shown in place without navigating;
//   - "Preview" returns res.render(), re-rendering THIS page in place with the
//     submitted text (allowed because the form's page and its action share a
//     path — Goribu's same-page render safety);
//   - "Send" sets a cookie and redirects with 303 to the thanks page, which the
//     client follows without a full document load.
// Before hydration the same <form> submits as a native multipart POST. Render
// and redirect results keep normal document behavior; enhanced in-place
// validation is intentionally JavaScript-owned.
export default function FeedbackPage({ message = "", preview = false } = {}) {
  return (
    <main className="content">
      <article>
        <h1>Feedback</h1>
        <p>
          Send a note. Preview keeps you on this page; sending sets a cookie and
          redirects you to a confirmation page.
        </p>

        {preview ? (
          <blockquote className="preview">
            <p className="preview-label">Preview</p>
            <p>{message}</p>
          </blockquote>
        ) : null}

        <Form method="post" action="/feedback">
          {({ pending, errors }) => (
            <>
              {errors?.root ? (
                <p className="field-error" role="alert">
                  {errors.root}
                </p>
              ) : null}
              <p>
                <label htmlFor="message">Your message</label>
                <br />
                <textarea
                  id="message"
                  name="message"
                  rows="4"
                  cols="40"
                  defaultValue={message}
                />
                {errors?.message ? (
                  <span className="field-error" role="alert">
                    {errors.message}
                  </span>
                ) : null}
              </p>
              <p>
                <button name="intent" value="preview" type="submit" disabled={pending}>
                  Preview
                </button>{" "}
                <button
                  className="button"
                  name="intent"
                  value="send"
                  type="submit"
                  disabled={pending}
                >
                  Send feedback
                </button>
              </p>
            </>
          )}
        </Form>

        <p>
          <Link href="/">Back to home</Link>
        </p>
      </article>
    </main>
  );
}

export async function POST(req, res) {
  const body = await req.body();
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const intent = typeof body.intent === "string" ? body.intent : "send";

  if (message.length === 0) {
    return res.invalid({ message: "Enter a message before sending." });
  }

  if (intent === "preview") {
    // Same-page render: the form lives on /feedback and posts to /feedback, so
    // Goribu allows re-rendering this route in place with the submitted text.
    return res.render({ message, preview: true });
  }

  // A cookie set by the handler, flushed as Set-Cookie on the 303 response.
  req.cookies.set("last_feedback", "received", {
    path: "/feedback",
    httpOnly: true,
    sameSite: "Lax",
  });

  return res.redirect("/feedback/thanks");
}
