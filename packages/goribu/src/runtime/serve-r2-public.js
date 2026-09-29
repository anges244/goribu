/** Development only: serve the configured public bucket, never its private peer. */
export async function serveR2Public(request, r2, config) {
  if (!config?.domain) return new Response(null, { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  }
  let key;
  try {
    key = decodeURIComponent(new URL(request.url).pathname.slice("/_goribu/r2/public/".length));
  } catch {
    return new Response("[Goribu] Malformed R2 public-file key. Use req.r2.url(key) to encode the object key.", { status: 400 });
  }
  if (!key) return new Response(null, { status: 404 });

  // Only ETag revalidation is supported by this development endpoint. Let R2
  // evaluate the condition atomically with the read, including lists and '*'.
  const condition = new Headers();
  const etag = request.headers.get("if-none-match");
  if (etag !== null) condition.set("if-none-match", etag);
  const object = await r2.get(key, { onlyIf: condition });
  if (object === null) return new Response(null, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "no-cache");
  if (object.body === undefined) return new Response(null, { status: 304, headers });
  headers.set("content-length", String(object.size));
  if (request.method === "HEAD") {
    await object.body.cancel();
    return new Response(null, { headers });
  }
  return new Response(object.body, { headers });
}
