export async function GET(req, res) {
  const key = req.query.get("key") ?? "/fixture";
  return res.json({ value: await req.cache.get(key) });
}

export async function POST(req, res) {
  const key = req.query.get("key") ?? "/fixture";
  const { value, ttl } = await req.body();
  await req.cache.set(key, value, { ttl });
  return res.text("Stored");
}

export async function DELETE(req, res) {
  await req.cache.delete(req.query.get("key") ?? "/fixture");
  return res.text("Deleted");
}
