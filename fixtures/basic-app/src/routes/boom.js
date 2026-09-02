export function GET() {
  throw new Error("fixture boom secret");
}

export async function POST(req, res) {
  const body = await req.body();
  return res.json({ received: body });
}
