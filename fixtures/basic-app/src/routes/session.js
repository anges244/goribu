// A dynamic handler route that proves incoming and outgoing cookie transport
// through the built Worker. Each request reports and persists the next visit count.
export function GET(req, res) {
  const incoming = Number.parseInt(req.cookies.get("visits") ?? "0", 10);
  const visits = Number.isNaN(incoming) ? 1 : incoming + 1;

  req.cookies.set("visits", String(visits));
  return res.json({ visits });
}
