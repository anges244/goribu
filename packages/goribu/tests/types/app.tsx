import { createRef } from "react";
import { ClientEntry, Form, Link, NavLink, Stylesheet, navigate } from "goribu";
import type { DocumentProps, Meta } from "goribu";
import { createApp, defineConfig } from "goribu/server";
import type { Handler, Middleware } from "goribu/server";
import { goribu } from "goribu/vite";
import "goribu/client";

interface Env { GREETING: string }
interface Props { name: string }

const config = defineConfig<Env>({
  name: "typed-app",
  compatibilityDate: "2026-08-31",
  database: { type: "d1", name: "typed-app-db" },
  kv: { name: "typed-app-kv" },
  responseHeaders: ({ request, env, nonce }) => ({
    "x-greeting": env.GREETING,
    "x-method": request.method,
    "content-security-policy": `script-src 'nonce-${nonce}'`,
  }),
});
defineConfig(config);
const middleware: Middleware<Env> = (req, res) => {
  if (!req.cookies.get("session")) return res.redirect("/login");
  req.cookies.set("visited", "yes", { httpOnly: true, sameSite: "Lax", maxAge: 60 });
  req.cookies.delete("old", { path: "/" });
};
const continuingMiddleware: Middleware = (req) => { req.cookies.set("visited", "yes"); };
// @ts-expect-error Matched URL parameters are strings.
type InvalidParams = Handler<Props, Env, { id: number }>;

const GET: Handler<Props, Env, { id: string }> = async (req, res) => {
  const id: string = req.params.id;
  const row = await req.d1<Props>`SELECT name FROM names WHERE id = ${id}`.get();
  const count = await req.d1.public`SELECT count(*) FROM names`.value<number>();
  const rows: Props[] = await req.d1.fresh.unsafe<Props>("SELECT name FROM names").all();
  const [first] = await req.d1.atomic([req.d1<Props>`SELECT name FROM names`]);
  const names: Props[] = first.rows;
  const cached: Props | null = await req.kv.get<Props>(id, { type: "json" });
  const entry = await req.kv.get<Props, { saved: string }>(id, { type: "json", metadata: true });
  const saved: string | undefined = entry.metadata?.saved;
  const text: string | null = await req.kv.get(id);
  const binary: ArrayBuffer | null = await req.kv.get(id, { type: "arrayBuffer" });
  const page = await req.kv.list<{ saved: string }>({ prefix: "name:" });
  if (!page.list_complete) { const cursor: string = page.cursor; }
  req.waitUntil(req.kv.put(id, JSON.stringify(row), { expirationTtl: 300 }));
  await req.kv.delete("old");
  const body = await req.body();
  if (body instanceof FormData) body.get("name");
  else if (typeof body === "string") body.trim();
  else if (typeof body.name === "string") body.name.trim();
  const bytes: Uint8Array = await req.rawBody();
  // @ts-expect-error Raw body parsing does not promise an application schema.
  body.name.trim();
  // @ts-expect-error Environment properties must be declared by the app.
  req.env.SECRET;
  // @ts-expect-error The Worker execution context stays private.
  req.ctx;
  // @ts-expect-error D1 parameters are bound scalar values, not arbitrary objects.
  req.d1`SELECT ${new Date()}`;
  // @ts-expect-error Atomic accepts unexecuted statements.
  req.d1.atomic([req.d1`DELETE FROM names`.run()]);
  // @ts-expect-error Freshness modes cannot be chained.
  req.d1.fresh.public`SELECT 1`;
  // @ts-expect-error KV accepts one key, not a bulk API.
  req.kv.get([id]);
  // @ts-expect-error KV requires an options object.
  req.kv.get(id, "json");
  // @ts-expect-error Render props are tied to this route's page.
  res.render({ name: 42 });
  // @ts-expect-error Required page props cannot be omitted.
  res.render();
  // @ts-expect-error Status is set on the response builder.
  res.redirect("/", 302);
  // @ts-expect-error Headers are a plain map of strings or string arrays.
  res.headers(new Headers());
  // @ts-expect-error Cookie deletion accepts only matching path and domain.
  req.cookies.delete("old", { maxAge: 0 });
  return res.headers({ "cache-control": "no-store" }).render({ name: row?.name ?? req.env.GREETING });
};
const POST: Handler = (_req, res) => res.invalid({ name: "Enter a name." });
// @ts-expect-error Only res.* intents are accepted from a route handler.
const BAD: Handler = (_req, _res) => {
  return new Response("unsupported");
};

export const meta: Meta<Props> = ({ props, url }) => ({
  title: props.name,
  canonical: url.href,
  meta: [{ property: "og:title", content: props.name }],
  links: [{ rel: "icon", href: "/favicon.svg" }],
});
// @ts-expect-error Metadata functions must resolve synchronously.
const badMeta: Meta<Props> = async () => ({ title: "async" });

function Document({ children, head, nonce }: DocumentProps) {
  return <html><head><Stylesheet />{head}</head><body><div id="root">{children}</div><ClientEntry src="/src/client-entry.js" nonce={nonce} /></body></html>;
}
const ui = <>
  <Link href="/hello" replace prefetch={false} onClick={(event) => event.preventDefault()}>Hello</Link>
  <NavLink href="/hello" end className={({ isActive }) => isActive ? "active" : undefined}>Hello</NavLink>
  <Form<Props> method="post" ref={createRef<HTMLFormElement>()} reset onResult={(result) => {
    if (result.ok) result.data?.name.toUpperCase();
    else result.errors.root;
  }}>{({ pending, errors, data }) => <button disabled={pending}>{errors?.name ?? data?.name ?? "Save"}</button>}</Form>
</>;
// @ts-expect-error The form method is explicit.
const missingMethod = <Form />;
// @ts-expect-error Mutations use POST and named controls for intent.
const unsupportedMethod = <Form method="delete" />;
// @ts-expect-error Goribu owns form encoding.
const unsupportedEncoding = <Form method="post" encType="text/plain" />;
// @ts-expect-error Stylesheet takes no props.
const ownStyles = <Stylesheet href="/styles.css" />;
navigate("/", { replace: true });
// @ts-expect-error No undocumented options.
navigate("/", { scroll: false });
goribu();
// @ts-expect-error Vite integration takes no options.
goribu({});
// @ts-expect-error Application configuration belongs to goribu/server.
import { defineConfig as sharedConfig } from "goribu";
// @ts-expect-error Browser bootstrap has no named public API.
import { startClient } from "goribu/client";
// @ts-expect-error Unknown configuration fields do not pass validation.
defineConfig({ name: "typed-app", compatibilityDate: "2026-08-31", adapter: "node" });

const app = createApp({
  manifest: [], modules: new Map([["_document", { default: Document }]]),
  errorPages: { notFound: null }, documentId: "_document", applicationConfig: config,
});
const response: Promise<Response> = app.fetch(new Request("https://app.test"), { GREETING: "Hello" }, { waitUntil() {} });
// @ts-expect-error Binding shape follows application configuration.
app.fetch(new Request("https://app.test"), {}, { waitUntil() {} });
// @ts-expect-error Raw config is unbranded and rejected by createApp.
createApp({ manifest: [], modules: new Map(), errorPages: { notFound: null }, applicationConfig: { name: "raw", compatibilityDate: "2026-08-31" } });
