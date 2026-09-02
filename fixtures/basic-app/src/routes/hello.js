import { FIXTURE_TOKEN } from "../secret.server.js";

// A route with named method handlers and no page component. It exercises Block
// 4's Worker runtime surface: GET uses the real Static Assets binding and bound
// waitUntil capability, while POST parses the request body through req.body().
export function GET(req, res) {
  req.waitUntil(Promise.resolve());
  return res.json({
    hasAssets: typeof req.env?.ASSETS?.fetch === "function",
    hasServerToken: FIXTURE_TOKEN === "fixture-server-only-token",
  });
}

export async function POST(req, res) {
  const body = await req.body();
  return res.json({ received: body });
}
