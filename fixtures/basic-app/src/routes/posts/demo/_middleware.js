export default function demoMiddleware(req, res) {
  req.middlewareTrace.push("demo");
  res.headers({
    "x-demo-middleware": "yes",
    "x-middleware-order": req.middlewareTrace.join(","),
  });

  if (req.query.get("middleware") === "demo") {
    return res.redirect("/login");
  }
}
