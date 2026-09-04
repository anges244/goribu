export async function POST(req, res) {
  const value = await req.rawBody();
  await req.env.KV.put("binding-proof", value);
  return res.text("Stored");
}

export async function GET(req, res) {
  return res.json({ value: await req.env.KV.get("binding-proof") });
}
