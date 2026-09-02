export function GET(req, res) {
  return res
    .headers({ "x-handler": "yes" })
    .json({ middleware: req.middlewareTrace });
}
