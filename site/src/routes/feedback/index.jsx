import { Link } from "goribu";

// A route that exports both a page and a POST handler — the request surface in
// use on the live site. GET renders the form (statically impossible here: the
// folder has middleware, so the whole /feedback subtree is Worker-served). POST
// reads the submitted body, sets a cookie, and redirects with 303 to the thanks
// page — the "POST that redirects" the block's gate asks for.
export default function FeedbackPage() {
  return (
    <main className="content">
      <article>
        <h1>Feedback</h1>
        <p>
          Send a note. Submitting POSTs this form; the handler sets a cookie and
          redirects you to a confirmation page.
        </p>
        <form method="post" action="/feedback">
          <p>
            <label htmlFor="message">Your message</label>
            <br />
            <textarea id="message" name="message" rows="4" cols="40" required />
          </p>
          <p>
            <button className="button" type="submit">
              Send feedback
            </button>
          </p>
        </form>
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

  // A cookie set by the handler, flushed as Set-Cookie on the 303 response.
  req.cookies.set("last_feedback", message ? "received" : "empty", {
    path: "/feedback",
    httpOnly: true,
    sameSite: "Lax",
  });

  return res.redirect("/feedback/thanks");
}
