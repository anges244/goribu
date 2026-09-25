import { createElement as h, useContext } from "react";
import { RenderDataContext } from "./render-context.js";

// Error pages must remain usable without application CSS or JavaScript. Keep
// these styles local to the built-in pages and authorize them with the same
// request nonce used by the application's CSP policy.
const CSS = `
body:has(.goribu-error) { margin: 0; }
.goribu-error {
  --ge-bg: #f7f7f8;
  --ge-panel: #fff;
  --ge-text: #202124;
  --ge-muted: #62666d;
  --ge-border: #e2e3e7;
  --ge-button: #24262b;
  --ge-button-text: #fff;
  box-sizing: border-box;
  min-height: 100vh;
  min-height: 100svh;
  display: grid;
  place-items: center;
  padding: 32px 20px;
  background: var(--ge-bg);
  color: var(--ge-text);
  color-scheme: light dark;
  font: 400 16px/1.6 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.goribu-error *, .goribu-error *::before, .goribu-error *::after { box-sizing: border-box; }
.goribu-error .ge-card {
  width: 100%;
  max-width: 560px;
  min-width: 0;
  padding: 48px;
  border: 1px solid var(--ge-border);
  border-radius: 20px;
  background: var(--ge-panel);
  box-shadow: 0 12px 40px rgb(0 0 0 / .035);
}
.goribu-error .ge-status {
  margin: 0 0 20px;
  color: var(--ge-muted);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: .12em;
}
.goribu-error h1 {
  margin: 0;
  color: var(--ge-text);
  font-size: clamp(32px, 6vw, 48px);
  line-height: 1.08;
  font-weight: 650;
  letter-spacing: -.04em;
  overflow-wrap: anywhere;
}
.goribu-error .ge-message { margin: 20px 0 0; color: var(--ge-muted); }
.goribu-error .ge-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 28px; }
.goribu-error a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 10px 16px;
  border: 1px solid var(--ge-border);
  border-radius: 9px;
  background: var(--ge-panel);
  color: var(--ge-text);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  text-decoration: none;
}
.goribu-error a.ge-primary { border-color: var(--ge-button); background: var(--ge-button); color: var(--ge-button-text); }
.goribu-error a:hover { text-decoration: underline; text-underline-offset: 3px; }
.goribu-error a:focus-visible { outline: 2px solid var(--ge-text); outline-offset: 4px; }
.goribu-error .ge-details { margin: 32px 0 0; padding: 20px 0 0; border-top: 1px solid var(--ge-border); font-size: 12px; }
.goribu-error .ge-details div + div { margin-top: 12px; }
.goribu-error dt { margin: 0 0 3px; color: var(--ge-muted); font-weight: 500; }
.goribu-error dd { margin: 0; overflow-wrap: anywhere; }
.goribu-error code { border: 0; padding: 0; background: transparent; color: var(--ge-text); font: 400 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
@media (prefers-color-scheme: dark) {
  .goribu-error {
    --ge-bg: #141518;
    --ge-panel: #1c1d21;
    --ge-text: #f1f2f4;
    --ge-muted: #a6a9b1;
    --ge-border: #34363d;
    --ge-button: #f1f2f4;
    --ge-button-text: #202124;
  }
}
@media (max-width: 480px) {
  .goribu-error { padding: 24px 16px; }
  .goribu-error .ge-card { padding: 32px 24px; border-radius: 16px; }
}
`;

/** The two built-in pages share presentation, never an application's props. */
export function DefaultErrorPage({ status, url, errorId, cfRay, retryUrl }) {
  const nonce = useContext(RenderDataContext)?.nonce;
  const serverError = status === 500;
  const title = serverError ? "Something went wrong." : "Page not found.";
  const details = [
    ...(url ? [["Page", url]] : []),
    ...(errorId ? [["Error ID", errorId]] : []),
    ...(cfRay ? [["Cloudflare Ray ID", cfRay]] : []),
  ];

  return h(
    "main",
    { className: "goribu-error" },
    h("style", { nonce }, CSS),
    h(
      "section",
      { className: "ge-card", "aria-labelledby": "goribu-error-title" },
      h("p", { className: "ge-status" }, String(status)),
      h("h1", { id: "goribu-error-title" }, title),
      h(
        "p",
        { className: "ge-message" },
        serverError
          ? "An unexpected error occurred while loading this page. Please try again in a moment."
          : "The page you’re looking for could not be found. It may have moved, or the address may be incorrect.",
      ),
      h(
        "nav",
        { className: "ge-actions", "aria-label": "Error recovery" },
        // The absolute request URL ignores Document <base> elements. The error
        // boundary removes its fragment; following this link always uses GET.
        serverError && retryUrl
          ? h("a", { className: "ge-primary", href: retryUrl }, "Try again")
          : null,
        h(
          "a",
          { className: serverError ? undefined : "ge-primary", href: "/" },
          "Go home",
        ),
      ),
      details.length
        ? h(
            "dl",
            { className: "ge-details", "aria-label": "Request details" },
            details.map(([label, value]) =>
              h(
                "div",
                { key: label },
                h("dt", null, label),
                h("dd", null, h("code", null, value)),
              ),
            ),
          )
        : null,
    ),
  );
}
