function markPosts(req, res) {
  req.middlewareTrace = ["posts"];
  res.headers({ "x-posts-middleware": "yes" });
}

function stopAtPosts(req, res) {
  req.middlewareTrace.push("posts-gate");
  if (req.query.get("middleware") === "posts") {
    return res.redirect("/login");
  }
}

export default [markPosts, stopAtPosts];
