// A handler that always throws, to exercise the error boundary against the live
// app. In production this renders _500 with a correlation ID and no raw detail;
// in development (goribu dev) it discloses the error. It exports no page, so it
// is a Worker-served handler route.
export function GET() {
  throw new Error("Intentional error from /boom to exercise the _500 boundary.");
}
