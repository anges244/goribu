// Folder-scoped middleware for the /feedback subtree. A default-exported array
// runs left to right — the documented order — and both functions share one req
// and res with the route. The `x-mw-order` header records the order they ran in,
// so it is observable on any /feedback response (the form, the POST redirect, and
// the thanks page).
//
// Because this file exists, every route under /feedback is served by the Worker
// rather than statically output — middleware runs per request. The rest of the
// site stays static.

function outer(req, res) {
  req.middlewareOrder = ["outer"];
  res.headers({ "x-mw-order": req.middlewareOrder.join(",") });
}

function inner(req, res) {
  req.middlewareOrder.push("inner");
  res.headers({ "x-mw-order": req.middlewareOrder.join(",") });

  // Short-circuit demonstration: `?mw=stop` ends the request here, before the
  // route runs, and the response still carries the headers set above.
  if (req.query.get("mw") === "stop") {
    return res.status(403).text("Blocked by middleware before the route ran.");
  }
}

export default [outer, inner];
