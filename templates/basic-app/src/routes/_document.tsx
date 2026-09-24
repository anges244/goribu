import { ClientEntry, Stylesheet } from "goribu";
import type { DocumentProps } from "goribu";

export default function Document({ children, head, nonce }: DocumentProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />

        <Stylesheet />
        {head}
      </head>

      <body className="bg-slate-50 text-slate-950 antialiased">
        <div id="root">{children}</div>

        <ClientEntry src="/src/client-entry.js" nonce={nonce} />
      </body>
    </html>
  );
}
