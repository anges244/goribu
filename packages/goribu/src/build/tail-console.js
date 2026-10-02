import { formatTailEvent } from "./format-tail-event.js";

// Loaded only in the Wrangler subprocess for terminal output. This relies on
// Wrangler 4.127.1 forwarding process.execArgv from its launcher and its JSON
// logger making one console.log call per event. Recheck both on Wrangler upgrades;
// unrecognized output passes through unchanged. Keep stdout attached to the
// terminal so Wrangler can use its normal interactive-auth detection.
const log = console.log.bind(console);
console.log = (...args) => {
  if (args.length === 1 && typeof args[0] === "string" && args[0].startsWith("{")) {
    let formatted = null;
    try {
      formatted = formatTailEvent(JSON.parse(args[0]));
    } catch {
      // Preserve unexpected output from Wrangler, including future event shapes.
    }
    if (formatted !== null) return log(formatted);
  }
  return log(...args);
};
