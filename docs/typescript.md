# TypeScript

TypeScript support is prepared for the upcoming 0.8.0 release.

New apps use TypeScript by default. Add `--js` to generate JavaScript:

```sh
npx create-goribu my-app
npx create-goribu my-js-app --js
```

Both variants include Tailwind and the same pages. Goribu maintains one
TypeScript starter and derives JavaScript during package preparation. JavaScript
output keeps JSX and omits TypeScript configuration and type dependencies.

## Check your app

From a TypeScript app directory, run:

```sh
pnpm typecheck
pnpm build
```

`typecheck` runs `tsc --noEmit`. Development and production builds transpile
TypeScript; they do not run the type checker. The starter enables strict checks,
type-only imports, and erasable TypeScript syntax. Its `skipLibCheck` setting
skips checking dependency declarations; Goribu's own declaration fixtures check
those declarations without that shortcut.

Routes use `.ts` or `.tsx`. Configuration stays in `goribu.config.js`, which Node
loads directly for development, builds, inspection, migrations, and deployment.
`vite.config.js` and `src/client-entry.js` also keep their existing names. The
starter's `allowJs` and `checkJs` settings check these JavaScript files too.

## Type a route

Use `Handler` from `goribu/server` to connect the response props to the page:

```tsx
import type { Handler } from "goribu/server";
import type { Meta } from "goribu";

type Props = { name: string };

export const GET: Handler<Props> = (req, res) => {
  const name = req.query.get("name")?.trim() || "friend";
  return res.render({ name });
};

export const meta: Meta<Props> = ({ props }) => ({
  title: `Hello, ${props.name}`,
});

export default function Hello({ name }: Props) {
  return <h1>Hello, {name}.</h1>;
}
```

The generic parameters are `Handler<Props, Env, Params>`. Define `Env` for your
app's bindings and `Params` for dynamic route segments, such as `{ id: string }`
for `[id].tsx`. Parameter names and page props are explicit; Goribu does not
generate route types or infer a handler's props from its default component.

`Middleware<Env>` types a function in `_middleware.ts`. Return a response intent
to stop or return nothing to continue; there is no `next` argument. A custom
Document uses `DocumentProps` from `goribu`. A custom `_500` page receives
`ServerErrorProps` from `goribu/server`, containing `errorId` and the safe `url`
pathname.

## Validate request input

Types do not validate network input. `req.body()` returns a record with unknown
values or text according to Content-Type. Both form encodings return records;
uploads are `File` values and repeated fields are arrays. Narrow that value before
using fields:

```ts
import type { Handler } from "goribu/server";

export const POST: Handler = async (req, res) => {
  const body = await req.body();
  const name = typeof body === "object" ? body.name : undefined;
  if (typeof name !== "string" || !name.trim()) {
    return res.invalid({ name: "Enter a name." });
  }
  return res.json({ name: name.trim() });
};
```

`req.d1<Row>` describes query result rows, and `req.kv.get<Value>(key,
{ type: "json" })` describes stored JSON. Those generics are application claims,
not schema validation. D1 values, freshness modes, atomic statements, KV
options, cookies, and response builders follow their runtime contracts.

## Type form results

`Form<Data>` types the JSON response data in its render callback and `onResult`:

```tsx
import { Form } from "goribu";

export default function NameForm() {
  return (
    <Form<{ name: string }> method="post" action="/name">
      {({ pending, errors, data }) => (
        <>
          <input name="name" aria-label="Name" />
          <button disabled={pending}>Save</button>
          <p>{errors?.name ?? data?.name}</p>
        </>
      )}
    </Form>
  );
}
```

The method is explicitly `get`, `post`, `put`, `patch`, or `delete` (lowercase or uppercase). Goribu selects form encoding. PUT, PATCH, and DELETE require hydration; see [Forms](./forms.md).
`onResult` can receive a successful navigation without JSON data, or a network
failure without a `Response`, so those fields remain optional.

## Package boundaries

All four existing entries have declarations: shared UI and metadata types in
`goribu`, Worker/configuration types in `goribu/server`, the side-effect-only
`goribu/client` bootstrap, and `goribu/vite` build integration. Use `import type`
for types so server declarations do not become browser runtime imports.

The framework remains JavaScript ESM with hand-written declarations and no
package compilation step. Public type fixtures run in the normal test suite
with both Bundler and NodeNext module resolution, and an export check rejects
runtime/declaration drift. Both generated languages are built through the real
Vite/Worker integration; independent installation is a separate release check.
