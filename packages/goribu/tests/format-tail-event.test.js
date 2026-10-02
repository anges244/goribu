import { expect, it } from "vitest";
import { formatTailEvent } from "../src/build/format-tail-event.js";

function fetchEvent(status, overrides = {}) {
  return {
    event: { request: { method: "GET", url: "https://example.com/page?test=1" }, response: { status } },
    eventTimestamp: Date.parse("2026-10-02T10:30:00.000Z"),
    outcome: "ok", logs: [], exceptions: [], ...overrides,
  };
}

it("shows real HTTP status and reason independently of a successful Worker outcome", () => {
  for (const [status, reason] of [[200, "OK"], [404, "Not Found"], [500, "Internal Server Error"], [302, "Found"]]) {
    expect(formatTailEvent(fetchEvent(status))).toBe(
      `GET https://example.com/page?test=1 - ${status} ${reason} @ 2026-10-02T10:30:00.000Z`,
    );
  }
});

it("keeps exception outcomes separate from missing or successful HTTP responses", () => {
  const event = fetchEvent(undefined, { outcome: "exception" });
  delete event.event.response;
  expect(formatTailEvent(event)).toContain("HTTP status unavailable");
  expect(formatTailEvent(event)).toContain("[Worker outcome: exception]");
  expect(formatTailEvent(fetchEvent(200, { outcome: "exception" }))).toContain(
    "200 OK @ 2026-10-02T10:30:00.000Z [Worker outcome: exception]",
  );
  for (const status of [null, "404", 0, 600, 200.5]) {
    expect(formatTailEvent(fetchEvent(status))).toContain("HTTP status unavailable");
  }
});

it("preserves console levels, structured messages, exceptions, stacks, and truncation", () => {
  const output = formatTailEvent(fetchEvent(500, {
    outcome: "exception",
    logs: [{ level: "warn", message: ["lookup failed", { id: 7, nested: { retry: false } }, null] },
      { level: "log", message: ["first line\nsecond line"] }],
    exceptions: [
      { name: "TypeError", message: "Missing user", stack: "TypeError: Missing user\n    at handler (index.js:42:3)" },
      { name: "CustomError", message: "Message from payload", stack: "custom stack\n    at anotherHandler (index.js:50:3)" },
      { name: "Error", message: "No stack available" },
    ],
    truncated: true,
  }));
  expect(output).toContain('  (warn) lookup failed {"id":7,"nested":{"retry":false}} null');
  expect(output).toContain("  (log) first line\n  second line");
  expect(output).toContain("  TypeError: Missing user\n      at handler (index.js:42:3)");
  expect(output.match(/TypeError: Missing user/g)).toHaveLength(1);
  expect(output).toContain("  CustomError: Message from payload\n  custom stack\n      at anotherHandler (index.js:50:3)");
  expect(output).toContain("  Error: No stack available");
  expect(output).toContain("[Tail event truncated]");
  expect(output).not.toContain("\u001b[");
});

it("does not invent timestamps or discard output it does not recognize", () => {
  for (const eventTimestamp of [undefined, null, "yesterday", Number.NaN, 1e30]) {
    expect(formatTailEvent(fetchEvent(200, { eventTimestamp }))).toContain("timestamp unavailable");
  }
  for (const payload of [null, "connected", [], {}, { event: { scheduledTime: 10 } },
    { event: { request: { method: "GET" } } }, fetchEvent(200, { outcome: undefined }),
    fetchEvent(200, { logs: [{ message: ["unrecognized"] }] })]) {
    expect(formatTailEvent(payload)).toBeNull();
  }
});
