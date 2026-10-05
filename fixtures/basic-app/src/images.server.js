// This module must never be requested or evaluated by the browser.
const privateMarker = "NESTED_SERVER_SOURCE_MUST_NOT_REACH_BROWSER";

export function imageLabel() {
  if (!privateMarker) throw new Error("Missing fixture marker");
  return "images loaded";
}
