import { Form, Link } from "goribu";

export const meta = {
  title: "Feedback - Goribu",
  description: "Send feedback through Goribu's enhanced Form runtime.",
};

// The request surface and the client runtime meeting on one route. The page is a
// hydrated <Form>; its handlers drive all three enhanced outcomes:
//   - an empty message returns res.invalid(), shown in place without navigating;
//   - "Preview" returns res.render(), re-rendering THIS page in place with the
//     submitted text (allowed because the form's page and its action share a
//     path — Goribu's same-page render safety);
//   - "Send" stores the message in D1 and redirects with 303 to the thanks page,
//     which the client follows without a full document load. The D1 bookmark on
//     that redirect makes the follow-up GET see the write even through a replica.
// Before hydration the same <form> submits as a native multipart POST. Render
// and redirect results keep normal document behavior; enhanced in-place
// validation is intentionally JavaScript-owned.
export default function FeedbackPage({
  message = "",
  preview = false,
  entries = [],
} = {}) {
  return (
    <main className="content">
      <article>
        <h1>Feedback</h1>
        <p>
          Send a note. Preview keeps you on this page; sending stores it and
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

        <section aria-labelledby="recent-feedback">
          <h2 id="recent-feedback">Recent messages</h2>
          {entries.length === 0 ? (
            <p>No feedback has been sent yet.</p>
          ) : (
            <ol className="feedback-entries">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <p>{entry.message}</p>
                  <time dateTime={entry.createdAt}>{entry.createdAt}</time>
                </li>
              ))}
            </ol>
          )}
        </section>

        <p>
          <Link href="/">Back to home</Link>
        </p>
      </article>
    </main>
  );
}

export async function GET(req, res) {
  const entries = await loadRecentFeedback(req.d1);
  return res.render({ entries });
}

export async function POST(req, res) {
  const body = await req.body();
  const submittedMessage = readField(body, "message");
  const submittedIntent = readField(body, "intent");
  const message =
    typeof submittedMessage === "string" ? submittedMessage.trim() : "";
  const intent = typeof submittedIntent === "string" ? submittedIntent : "send";

  if (message.length === 0) {
    return res.invalid({ message: "Enter a message before sending." });
  }

  if (intent === "preview") {
    // Same-page render: the form lives on /feedback and posts to /feedback, so
    // Goribu allows re-rendering this route in place with the submitted text.
    const entries = await loadRecentFeedback(req.d1);
    return res.render({ message, preview: true, entries });
  }

  await req.d1`
    INSERT INTO feedback (message, created_at)
    VALUES (${message}, ${new Date().toISOString()})
  `.run();

  return res.redirect("/feedback/thanks");
}

function readField(body, name) {
  return body instanceof FormData ? body.get(name) : body?.[name];
}

async function loadRecentFeedback(d1) {
  return d1`
    SELECT id, message, created_at AS createdAt
    FROM feedback
    ORDER BY id DESC
    LIMIT 10
  `.all();
}
