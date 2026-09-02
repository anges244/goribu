// The confirmation page the feedback POST redirects to. It lives under
// /feedback, so the folder middleware applies to it too — the x-mw-order header
// is present on this page as well.
export default function ThanksPage() {
  return (
    <main className="content">
      <article>
        <h1>Thanks</h1>
        <p>Your feedback was received.</p>
        <p>
          <a href="/feedback">Send another</a> · <a href="/">Back to home</a>
        </p>
      </article>
    </main>
  );
}
