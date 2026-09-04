import { Link } from "goribu";
import { loadCommunityFeedback } from "../community.server.js";

export const meta = {
  title: "Community feedback - Goribu",
  description: "Recent notes from people trying Goribu.",
};

export async function GET(req, res) {
  const snapshot = await loadCommunityFeedback(req);
  return res.headers({ "cache-control": "no-store" }).render(snapshot);
}

export default function CommunityPage({ entries = [], generatedAt } = {}) {
  return (
    <main className="content">
      <article>
        <h1>Community feedback</h1>
        <p>Recent notes from people trying Goribu.</p>
        <p>
          This is a saved snapshot. New messages may take a few minutes to appear.
          {generatedAt ? <> Updated <time dateTime={generatedAt}>{generatedAt}</time>.</> : null}
        </p>
        {entries.length === 0 ? (
          <p>No messages in this snapshot yet. Be the first to send one.</p>
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
        <p><Link href="/feedback">Send feedback</Link> · <Link href="/">Back to home</Link></p>
      </article>
    </main>
  );
}
