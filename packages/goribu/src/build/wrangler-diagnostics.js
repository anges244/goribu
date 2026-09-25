// Keep Wrangler's diagnostics, but direct ordinary login through Goribu's CLI.
// Commands with flags stay intact: cloudflare-login does not accept those flags.
export const CLOUDFLARE_AUTH_HELP =
  "If authentication is needed, run `pnpm exec goribu cloudflare-login` locally or configure CLOUDFLARE_API_TOKEN for non-interactive use. ";

export function forwardWranglerDiagnostics(stream, destination = process.stderr) {
  // Ignored stdio (the secrets dry run) has no readable stream.
  if (!stream) return;
  stream.setEncoding("utf8");
  let pending = "";

  const write = (text) => destination.write(text.replace(
    /\b(?:npx |pnpm exec )?wrangler login(?![\w-]|[ \t]+-)/g,
    "pnpm exec goribu cloudflare-login",
  ));

  // Pipe chunks can split a command or a UTF-8 character. Decode through the
  // stream and forward complete lines, including an unterminated final line.
  stream.on("data", (chunk) => {
    pending += chunk;
    const end = pending.lastIndexOf("\n") + 1;
    if (end === 0) return;
    write(pending.slice(0, end));
    pending = pending.slice(end);
  });
  stream.on("end", () => {
    if (pending) write(pending);
  });
}
