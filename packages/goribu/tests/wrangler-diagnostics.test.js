import { once } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import { forwardWranglerDiagnostics } from "../src/build/wrangler-diagnostics.js";

it("translates login instructions across pipe and UTF-8 boundaries without changing other diagnostics", async () => {
  const original = '\u001b[31mError: accès denied\u001b[0m\nRun `wrangler login` or set CLOUDFLARE_API_TOKEN.\n' +
    'Try `npx wrangler login` or `pnpm exec wrangler login`.\n' +
    'Keep `wrangler login --scopes-list`, `wrangler logout`, and `wrangler login-extra`.\n' +
    'Final instruction: `wrangler login`';
  const expected = '\u001b[31mError: accès denied\u001b[0m\nRun `pnpm exec goribu cloudflare-login` or set CLOUDFLARE_API_TOKEN.\n' +
    'Try `pnpm exec goribu cloudflare-login` or `pnpm exec goribu cloudflare-login`.\n' +
    'Keep `wrangler login --scopes-list`, `wrangler logout`, and `wrangler login-extra`.\n' +
    'Final instruction: `pnpm exec goribu cloudflare-login`';
  const bytes = Buffer.from(original);
  for (let split = 0; split <= bytes.length; split++) {
    const stream = new PassThrough();
    let output = "";
    forwardWranglerDiagnostics(stream, { write: (text) => { output += text; } });
    const ended = once(stream, "end");
    stream.write(bytes.subarray(0, split));
    stream.end(bytes.subarray(split));
    await ended;
    expect(output).toBe(expected);
  }
});
