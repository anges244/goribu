// A route with named method handlers and no page component. GET returns JSON;
// POST redirects. This exercises Block 4's handler dispatch and the response
// builder (res.json, res.redirect) end to end.
export function GET(req, res) {
  return res.json({ message: "Hello from a GET handler", method: req.method });
}

export function POST(req, res) {
  return res.redirect("/");
}
