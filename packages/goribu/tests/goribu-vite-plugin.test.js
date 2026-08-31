import { describe, expect, it } from "vitest";
import { goribu } from "goribu/vite";

describe("goribu()", () => {
  it("rejects options with a teaching error", () => {
    expect(() => goribu({})).toThrow(/does not accept options/);
  });

  it("returns a plugin array that includes the goribu plugin", () => {
    const plugins = goribu();
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins.some((plugin) => plugin?.name === "goribu")).toBe(true);
  });
});
