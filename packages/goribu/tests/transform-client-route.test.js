import { describe, expect, it } from "vitest";
import { transformClientRoute } from "../src/build/transform-client-route.js";

const id = "/app/src/routes/index.tsx";
const transform = (source) => transformClientRoute(source, id)?.code ?? source;

describe("client route separation", () => {
  it("removes server factories, aliases and recursive helpers while retaining shared page bindings", async () => {
    const source = `
import { secret } from "../body.server.js";
const title = "shared";
const policy = makePolicy();
function makePolicy() { return { secret, title }; }
function save() { return recurse(); }
function recurse() { return save() || secret; }
export { save as POST };
export const uploads = policy, label = title;
export const meta = () => ({ title });
export const prerender = false;
export const allowCrossOriginForms = Boolean(secret);
export default function Page() { const secret = "local"; return title + secret; }
`;
    const result = transformClientRoute(source, id);
    expect(result.code).not.toMatch(/body\.server|makePolicy|recurse|save|uploads|prerender|meta|allowCrossOriginForms/);
    const page = await import(`data:text/javascript,${encodeURIComponent(result.code)}`);
    expect(page.default()).toBe("sharedlocal");
    expect(page.label).toBe("shared");
    expect(result.map.sourcesContent.join("")).not.toMatch(/body\.server|makePolicy|recurse/);
  });

  it("preserves real page references, shared destructuring, writes and unrelated side effects", () => {
    const result = transform(`
import { secret } from "../body.server.js";
import "../styles.css";
const { handler, label } = secret();
export { handler as GET };
let state;
state = secret();
const setup = secret();
if (globalThis.enabled) { var blockValue = secret(); globalThis.observed = true; }
export function POST() { return blockValue; }
export default function Page() { return label + state; }
`);
    expect(result).toContain('import { secret }');
    expect(result).toContain('import "../styles.css"');
    expect(result).toContain('const { handler, label } = secret()');
    expect(result).toContain('state = secret()');
    expect(result).toContain('const setup = secret()');
    expect(result).toContain('globalThis.observed = true');
    expect(result).not.toContain('handler as GET');
  });

  it("handles mixed imports, re-exports, TypeScript and JSX references", () => {
    const result = transform(`
import Factory, { server as handler, View, type Props } from "../shared";
export { load as GET, save as POST } from "../body.server.js";
export const uploads = Factory(handler);
export default function Page(props: Props) { return <View {...props} />; }
`);
    expect(result).not.toMatch(/Factory|handler|body\.server|uploads/);
    expect(result).toContain('View, type Props');
    expect(result).toContain('<View {...props} />');
  });

  it("keeps a server-named declaration if the page also uses it", async () => {
    const result = transform('export function GET(value) { return value; } export default function Page() { return GET("shared"); }');
    const page = await import(`data:text/javascript,${encodeURIComponent(result)}`);
    expect(page.default()).toBe("shared");
    expect(page.GET).toBeUndefined();
  });

  it("rejects ambiguous wildcard exports with a repair instruction", () => {
    expect(() => transform('export * from "../handlers"; export default function Page() {}'))
      .toThrow(/\[Goribu\].*index\.tsx.*Replace the wildcard with explicit named re-exports/);
    expect(() => transform('const secret = "private"; export function GET() { return secret; } export default function Page() { return eval("secret"); }'))
      .toThrow(/\[Goribu\].*Replace eval with explicit references/);
  });
});
