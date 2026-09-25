import { ClientEntry, Stylesheet } from "goribu";
import type { DocumentProps } from "goribu";

export default function Document({ children, head, nonce }: DocumentProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />

        <Stylesheet />
        {head}
      </head>

      <body className="bg-canvas font-sans text-ink antialiased">
        <div id="root">{children}</div>

        <ClientEntry src="/src/setup/client-entry.js" nonce={nonce} />
      </body>
    </html>
  );
}
