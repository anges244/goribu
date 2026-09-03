import { describe, expect, it, vi } from "vitest";
import { createD1BindingResolver } from "../src/db/create-d1-binding-resolver.js";

describe("createD1BindingResolver", () => {
  it("resolves env.DB lazily and keeps one stable binding within a request", () => {
    const binding = { prepare: vi.fn(), batch: vi.fn(), withSession: vi.fn() };
    const readBinding = vi.fn(() => binding);
    const env = {};
    Object.defineProperty(env, "DB", { get: readBinding });

    const resolveD1Binding = createD1BindingResolver(env);

    expect(readBinding).not.toHaveBeenCalled();
    expect(resolveD1Binding()).toBe(binding);
    expect(resolveD1Binding()).toBe(binding);
    expect(readBinding).toHaveBeenCalledOnce();
  });

  it("isolates binding resolution between Worker requests", () => {
    const firstBinding = { request: "first" };
    const secondBinding = { request: "second" };
    const first = createD1BindingResolver({ DB: firstBinding });
    const second = createD1BindingResolver({ DB: secondBinding });

    expect(first()).toBe(firstBinding);
    expect(second()).toBe(secondBinding);
  });

  it.each([undefined, null])(
    "returns a fail-closed D1 stub when env.DB is %s",
    (DB) => {
      const missing = createD1BindingResolver({ DB })();
      const repair =
        "[Goribu] req.d1 was used but no D1 binding was found. Expected env.DB";

      expect(() => missing.prepare("SELECT 1")).toThrow(repair);
      expect(() => missing.batch([])).toThrow(repair);
      expect(() => missing.withSession("first-unconstrained")).toThrow(repair);
      expect(() => missing.prepare("SELECT 1")).toThrow(
        "Add\n`database: { type: 'd1', name: 'your-db-name' }` to goribu.config.js",
      );
      expect(() => missing.prepare("SELECT 1")).toThrow(
        "Goribu\nwill synthesize the env.DB binding for dev and deploy",
      );
    },
  );

  it("rejects invalid internal input with a repair instruction", () => {
    expect(() => createD1BindingResolver()).toThrow(
      "[Goribu] createD1BindingResolver(env) requires the Worker bindings object for one request. Pass env from the Worker fetch handler.",
    );
    expect(() => createD1BindingResolver([])).toThrow(
      "[Goribu] createD1BindingResolver(env) requires the Worker bindings object for one request. Pass env from the Worker fetch handler.",
    );
  });
});
