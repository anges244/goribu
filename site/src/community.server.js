const CACHE_KEY = "community-feedback:v1";

/** A public snapshot: no visitor state or D1 session bookmarks enter this cache. */
export async function loadCommunityFeedback(req) {
  const cached = await req.kv.get(CACHE_KEY, { type: "json" });
  if (cached !== null) return cached;

  const entries = await req.d1.public`
    SELECT id, message, created_at AS createdAt
    FROM feedback
    ORDER BY id DESC
    LIMIT 10
  `.all();
  const snapshot = { entries, generatedAt: new Date().toISOString() };

  // Cache fills can race across locations. Each is a complete, disposable
  // snapshot; a rate-limited fill must not discard a successful D1 read.
  try {
    await req.kv.put(CACHE_KEY, JSON.stringify(snapshot), { expirationTtl: 300 });
  } catch (error) {
    console.error("[Goribu site] Could not cache community feedback; serving the D1 snapshot.", error);
  }
  return snapshot;
}
