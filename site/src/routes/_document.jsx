import { ClientEntry, Stylesheet } from "goribu";

// The site's document shell. The application owns html, head, and body; Goribu
// renders each route's page as `children` inside the root element.
//
export default function Document({ children, head }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Stylesheet />
        {head}
      </head>
      <body>
        <div id="root">{children}</div>
        <ClientEntry src="/src/client-entry.js" />
      </body>
    </html>
  );
}
