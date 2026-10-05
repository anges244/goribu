// Exercises req.url and res.stream(). The default GET streams three chunks
// naming the request origin; ?bytes sends fixed bytes with the default
// application/octet-stream content type.
export function GET(req, res) {
  if (req.query.has("bytes")) return res.stream(new Uint8Array([103, 111, 114, 105, 98, 117]));

  const encoder = new TextEncoder();
  const chunks = [`origin=${req.url.origin}\n`, `path=${req.url.pathname}\n`, "done\n"];
  const body = new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk === undefined) controller.close();
      else controller.enqueue(encoder.encode(chunk));
    },
  });
  return res
    .headers({ "content-type": "text/plain; charset=utf-8", "x-request-origin": req.url.origin })
    .stream(body);
}
