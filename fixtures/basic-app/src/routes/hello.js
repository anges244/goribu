// A route with named method handlers and no page component. It exercises Block
// 4's handler dispatch and request surface: GET reads a query param, POST parses
// the request body (JSON or form-encoded) through req.body().
export function GET(req, res) {
  return res.json({
    greeting: `Hello, ${req.query.get("name") ?? "world"}`,
    method: req.method,
    path: req.path,
  });
}

export async function POST(req, res) {
  const body = await req.body();
  return res.json({ received: body });
}
