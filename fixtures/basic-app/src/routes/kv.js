export async function POST(req, res) {
  const value = await req.rawBody();
  const key = req.query.get("key") ?? "binding-proof";
  await req.kv.put(key, value, {
    expirationTtl: 120,
    metadata: { source: "fixture" },
  });
  return res.text("Stored");
}

export async function GET(req, res) {
  if (req.query.has("list")) {
    return res.json(await req.kv.list({
      prefix: req.query.get("prefix") ?? "",
      limit: 1,
      ...(req.query.has("cursor") ? { cursor: req.query.get("cursor") } : {}),
    }));
  }
  const key = req.query.get("key") ?? "binding-proof";
  if (req.query.has("metadata")) {
    return res.json(await req.kv.get(key, { metadata: true, type: "json" }));
  }
  return res.json({ value: await req.kv.get(key) });
}

export async function DELETE(req, res) {
  await req.kv.delete(req.query.get("key") ?? "binding-proof");
  return res.text("Deleted");
}
