import { ClientEntry } from "goribu";

// The site's document shell. The application owns html, head, and body; Goribu
// renders each route's page as `children` inside the root element.
//
// The title is site-wide here. Per-page titles from Markdown front matter arrive
// when the framework's metadata API lands in Block 5; until then the head is
// owned statically by this file.
export default function Document({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Goribu — a React framework for Cloudflare Workers</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <div id="root">{children}</div>
        <ClientEntry src="/src/client-entry.js" />
      </body>
    </html>
  );
}
