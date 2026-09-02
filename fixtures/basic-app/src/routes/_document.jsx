import { ClientEntry } from "goribu";

// A custom document shell. The application owns the html, head, and body here;
// Goribu renders each route's page as `children` inside it.
export default function Document({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Goribu basic app</title>
      </head>
      <body>
        <div id="root">{children}</div>
        <ClientEntry src="/src/client-entry.js" />
      </body>
    </html>
  );
}
