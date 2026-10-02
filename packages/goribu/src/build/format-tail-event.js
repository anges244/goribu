import { STATUS_CODES } from "node:http";

/** Format recognized fetch events; callers preserve other Wrangler output. */
export function formatTailEvent(payload) {
  const request = payload?.event?.request;
  if (!request || typeof request.method !== "string" || !request.method ||
      typeof request.url !== "string" || !request.url ||
      typeof payload.outcome !== "string" || !Array.isArray(payload.logs) ||
      !Array.isArray(payload.exceptions)) return null;

  const status = payload.event.response?.status;
  const response = Number.isInteger(status) && status >= 100 && status <= 599
    ? `${status}${STATUS_CODES[status] ? ` ${STATUS_CODES[status]}` : ""}`
    : "HTTP status unavailable";
  const timestamp = typeof payload.eventTimestamp === "number"
    ? new Date(payload.eventTimestamp) : null;
  const time = timestamp && Number.isFinite(timestamp.getTime())
    ? timestamp.toISOString() : "timestamp unavailable";
  const outcome = payload.outcome !== "ok"
    ? ` [Worker outcome: ${payload.outcome}]` : "";
  const lines = [`${request.method} ${request.url} - ${response} @ ${time}${outcome}`];

  for (const log of payload.logs) {
    if (!log || typeof log.level !== "string" || !Array.isArray(log.message)) return null;
    lines.push(indent(`(${log.level}) ${log.message.map(display).join(" ")}`));
  }
  for (const exception of payload.exceptions) {
    if (!exception || typeof exception.message !== "string") return null;
    const headline = `${typeof exception.name === "string" ? `${exception.name}: ` : ""}${exception.message}`;
    const stack = typeof exception.stack === "string" ? exception.stack : "";
    lines.push(indent(stack ? (stack.includes(headline) ? stack : `${headline}\n${stack}`) : headline));
  }
  if (payload.truncated === true) lines.push("  [Tail event truncated]");
  return lines.join("\n");
}

function display(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function indent(text) {
  return `  ${text.replace(/\n/g, "\n  ")}`;
}
