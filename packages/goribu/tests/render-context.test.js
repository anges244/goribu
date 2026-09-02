import { describe, expect, it } from "vitest";
import {
  serializePropsForScript,
  serializeRouteForScript,
} from "../src/rendering/render-context.js";

describe("render context serialization", () => {
  it("keeps script-breaking page data inert while preserving its JSON value", () => {
    const props = {
      markup: "</script><script>globalThis.pwned = true</script>",
      symbols: "<>&\u2028\u2029",
      optional: undefined,
    };
    const serialized = serializePropsForScript(props);

    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c/script\\u003e");
    expect(serialized).toContain("\\u0026");
    expect(serialized).toContain("\\u2028");
    expect(serialized).toContain("\\u2029");
    expect(JSON.parse(serialized)).toEqual({
      markup: props.markup,
      symbols: props.symbols,
    });
  });

  it("serializes the canonical route ID and rejects invalid hydration data", () => {
    const routeId = "src/routes/</script>.jsx";
    expect(JSON.parse(serializeRouteForScript(routeId))).toEqual({ id: routeId });
    expect(serializeRouteForScript(routeId)).not.toContain("</script>");

    for (const invalid of [undefined, null, ""]) {
      expect(() => serializeRouteForScript(invalid)).toThrow(
        /\[Goribu\].*matched route has no stable source ID/s,
      );
    }
    expect(() => serializePropsForScript({ value: 1n })).toThrow(
      /\[Goribu\].*Could not serialize page props/s,
    );
  });
});
