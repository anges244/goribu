import { createRef } from "react";
import { ClientEntry, Form, FileUpload, upload, UploadError, Link, NavLink, Stylesheet, navigate } from "goribu";
import type { DocumentProps, Meta } from "goribu";
import { createApp, defineConfig } from "goribu/server";
import type { GoribuCache, Handler, Middleware, ServerErrorProps } from "goribu/server";
import { goribu } from "goribu/vite";
import "goribu/client";

const postgresHandler: Handler = async (req, res) => {
  const rows = await req.postgres<{ id: number; tags: string[] }[]>`select id, tags from posts`;
  const row: { id: number; tags: string[] } = rows[0];
  await req.postgres.begin(async (tx) => { await tx`SELECT 1`; });
  await req.postgresCached`SELECT 1`;
  // @ts-expect-error Postgres clients are readonly request properties.
  req.postgres = req.postgresCached;
  // @ts-expect-error The client has the Postgres.js Sql type, not any.
  req.postgres.notAMethod();
  return res.json(row);
};

interface Env { GREETING: string }
interface Props { name: string }

const config = defineConfig<Env>({
  name: "typed-app",
  domain: "app.example.com",
  compatibilityDate: "2026-08-31",
  database: { type: "d1", name: "typed-app-db" },
  kv: { name: "typed-app-kv" },
  r2: { name: "typed-app-media", domain: "media.example.com", private: { name: "typed-app-files" }, jurisdiction: "eu" },
  responseHeaders: ({ request, env, nonce }) => ({
    "x-greeting": env.GREETING,
    "x-method": request.method,
    "content-security-policy": `script-src 'nonce-${nonce}'`,
  }),
});
defineConfig(config);
defineConfig({ name: "typed-app", compatibilityDate: "2026-09-01", database: { type: "postgres" } });
const postgresConfig = defineConfig({
  name: "typed-app", compatibilityDate: "2026-09-01",
  database: { type: "postgres", hyperdriveId: "direct-id", hyperdriveCachedId: "cached-id" },
});
defineConfig(postgresConfig);
if (postgresConfig.database?.type === "postgres" && postgresConfig.database.hyperdriveId !== undefined) {
  const cachedId: string = postgresConfig.database.hyperdriveCachedId;
  // @ts-expect-error Defined Postgres configuration is immutable.
  postgresConfig.database.hyperdriveId = "changed";
}
if (config.database?.type === "d1") {
  const databaseName: string = config.database.name;
  const replication: boolean | undefined = config.database.replication;
}
// @ts-expect-error Hyperdrive IDs must be supplied together.
defineConfig({ name: "typed-app", compatibilityDate: "2026-09-01", database: { type: "postgres", hyperdriveId: "direct-id" } });
// @ts-expect-error A cached Hyperdrive ID also requires the uncached ID.
defineConfig({ name: "typed-app", compatibilityDate: "2026-09-01", database: { type: "postgres", hyperdriveCachedId: "cached-id" } });
// @ts-expect-error Connection strings belong in POSTGRES_URL in env files.
defineConfig({ name: "typed-app", compatibilityDate: "2026-09-01", database: { type: "postgres", url: "postgres://localhost/app" } });
// @ts-expect-error Migration connection strings belong in POSTGRES_MIGRATE_URL in env files.
defineConfig({ name: "typed-app", compatibilityDate: "2026-09-01", database: { type: "postgres", migrateUrl: "postgres://localhost/app" } });
const applicationDomain: string | undefined = config.domain;
const workersDev: boolean = config.workersDev;
defineConfig({ name: "typed-app", compatibilityDate: "2026-09-01", domain: "app.example.com", workersDev: false });
// @ts-expect-error workersDev is a boolean.
defineConfig({ name: "typed-app", compatibilityDate: "2026-09-01", domain: "app.example.com", workersDev: "false" });
// @ts-expect-error Defined application configuration is immutable.
config.domain = "other.example.com";
// @ts-expect-error Only one hostname string is accepted.
defineConfig({ name: "typed-app", compatibilityDate: "2026-09-01", domain: ["app.example.com"] });
defineConfig({ name: "typed-app", compatibilityDate: "2026-09-01", r2: { name: "typed-app-files" } });
const wranglerConfig = defineConfig({
  name: "typed-app", compatibilityDate: "2026-09-01",
  wrangler: { ai: { binding: "AI" }, services: [{ binding: "SEARCH", service: "search-worker" }], vars: { API_HOST: "example.com", LIMITS: { max: 3 } } },
});
if (wranglerConfig.wrangler !== undefined) {
  const wranglerVars = wranglerConfig.wrangler.vars;
  // @ts-expect-error The wrangler snapshot is immutable.
  wranglerConfig.wrangler.ai = null;
}
// @ts-expect-error Goribu writes the KV binding from kv.
defineConfig({ name: "typed-app", compatibilityDate: "2026-09-01", wrangler: { kv_namespaces: [] } });
// @ts-expect-error The wrangler block holds JSON values only.
defineConfig({ name: "typed-app", compatibilityDate: "2026-09-01", wrangler: { vars: { NOW: new Date() } } });
// @ts-expect-error R2 names are required.
defineConfig({ name: "typed-app", compatibilityDate: "2026-09-01", r2: { domain: "media.example.com" } });
// @ts-expect-error Only EU or the omitted default jurisdiction is supported.
defineConfig({ name: "typed-app", compatibilityDate: "2026-09-01", r2: { name: "typed-app-files", jurisdiction: "us" } });
// @ts-expect-error Goribu owns binding names.
defineConfig({ name: "typed-app", compatibilityDate: "2026-09-01", r2: { name: "typed-app-files", binding: "OTHER" } });
// @ts-expect-error The second bucket has only a name.
defineConfig({ name: "typed-app", compatibilityDate: "2026-09-01", r2: { name: "typed-app-media", domain: "media.example.com", private: { name: "typed-app-files", domain: "files.example.com" } } });
if (config.r2?.private) {
  const name: string = config.r2.private.name;
  const jurisdiction: "eu" | undefined = config.r2.jurisdiction;
  // @ts-expect-error Defined R2 configuration is immutable.
  config.r2.domain = "changed.example.com";
  // @ts-expect-error The nested private bucket is also immutable.
  config.r2.private.name = "changed";
}
const middleware: Middleware<Env> = (req, res) => {
  if (!req.cookies.get("session")) return res.redirect("/login");
  req.cookies.set("visited", "yes", { httpOnly: true, sameSite: "Lax", maxAge: 60 });
  req.cookies.delete("old", { path: "/" });
};
const continuingMiddleware: Middleware = (req) => { req.cookies.set("visited", "yes"); };
declare module "goribu/server" {
  interface AppRequestFields { user?: { id: string } }
}
const loadUser: Middleware<Env> = (req) => { req.user = { id: "u1" }; };
const userHandler: Handler<Props, Env, { id: string }> = (req, res) => res.json({ id: req.user?.id });
const fileHandler: Handler = (req, res) => res.headers({ "content-type": "image/png" }).stream(new Uint8Array([1]));
// @ts-expect-error Strings belong in res.text(body).
const textStream: Handler = (req, res) => res.stream("text");
// @ts-expect-error Request fields must be declared on AppRequestFields.
const undeclaredField: Middleware = (req) => { req.team = "core"; };
// @ts-expect-error Matched URL parameters are strings.
type InvalidParams = Handler<Props, Env, { id: number }>;

const GET: Handler<Props, Env, { id: string }> = async (req, res) => {
  const id: string = req.params.id;
  const callbackUrl: string = new URL("/auth/callback", req.url.origin).href;
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
  const cache: GoribuCache = req.cache;
  const cachedName: Props | null = await cache.get<Props>(`/names/${id}`);
  req.waitUntil(cache.set(`/names/${id}`, row, { ttl: 300 }));
  await cache.set("/names", names);
  await cache.delete("/names", `/names/${id}`);
  const unknownCached = await cache.get("/names");
  // @ts-expect-error Untyped cache reads require narrowing before property access.
  unknownCached.name;
  // @ts-expect-error Cache set accepts only TTL options.
  cache.set("/names", names, { expirationTtl: 300 });
  // @ts-expect-error TTL is expressed in seconds as a number.
  cache.set("/names", names, { ttl: "300" });
  // @ts-expect-error The native Cache API is not exposed through the facade.
  cache.raw;
  const publicUrl: string = req.r2.url("avatars/a b.png");
  const signedUrl: string = await req.r2.signedUrl(id);
  const downloadUrl: string = await req.r2.private.signedUrl(id, { expiresIn: 600, download: "invoice.pdf" });
  // @ts-expect-error Signed link expiry is expressed in seconds as a number.
  req.r2.signedUrl(id, { expiresIn: "600" });
  const imageUrl: string = await req.r2.signedUrl(id, { expiresIn: 604800, immutable: true });
  await req.r2.private.signedUrl(id, { immutable: true });
  // @ts-expect-error Immutable caching is an explicit boolean promise.
  req.r2.signedUrl(id, { immutable: "yes" });
  const object = await req.r2.get(id);
  if (object) { const bytes: ArrayBuffer = await object.arrayBuffer(); }
  const conditional = await req.r2.get(id, { onlyIf: { etagDoesNotMatch: "etag" }, range: { offset: 0, length: 4 } });
  if (conditional && "body" in conditional) await conditional.text();
  const stored = await req.r2.put(id, new File(["csv"], "a.csv", { type: "text/csv" }), { httpMetadata: new Headers({ "cache-control": "no-store" }) });
  const storedKey: string = stored.key;
  const maybeStored = await req.r2.private.put(id, "text", { onlyIf: { etagDoesNotMatch: "*" } });
  if (maybeStored) { const etag: string = maybeStored.httpEtag; }
  const r2Page = await req.r2.list({ prefix: "avatars/", include: ["httpMetadata"] });
  if (r2Page.truncated) { const cursor: string = r2Page.cursor; }
  await req.r2.head(id);
  await req.r2.private.delete([id, "old"]);
  await req.r2.get(id, { onlyIf: new Headers({ "if-none-match": "etag" }) });
  const multipart = await req.r2.createMultipartUpload(id, { httpMetadata: new Headers({ "content-type": "text/plain" }) });
  const resumed = req.r2.private.resumeMultipartUpload(id, multipart.uploadId);
  await resumed.uploadPart(1, new Blob(["part"]));
  await resumed.abort();
  // @ts-expect-error Private buckets have no public URL helper.
  req.r2.private.url(id);
  // @ts-expect-error The private facade cannot be replaced.
  req.r2.private = req.r2;
  // @ts-expect-error Native R2 keys are strings.
  req.r2.get([id]);
  const body = await req.body();
  const parsedBody: Record<string, unknown> = body;
  const { name } = await req.body();
  if (typeof name === "string") name.trim();
  if (body.file instanceof File) {
    const filename: string = body.file.name;
  }
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
  return <html><head><Stylesheet />{head}</head><body><div id="root">{children}</div><ClientEntry src="/src/setup/client-entry.js" nonce={nonce} /></body></html>;
}
const ui = <>
  <Link href="/hello" replace prefetch={false} onClick={(event) => event.preventDefault()}>Hello</Link>
  <NavLink href="/hello" end className={({ isActive }) => isActive ? "active" : undefined}>Hello</NavLink>
  <Form<Props> method="post" ref={createRef<HTMLFormElement>()} reset onResult={(result) => {
    if (result.ok) result.data?.name.toUpperCase();
    else result.errors.root;
  }}>{({ pending, errors, data }) => <button disabled={pending}>{errors?.name ?? data?.name ?? "Save"}</button>}</Form>
  <Form method="put"><button>Replace</button></Form>
  <Form method="PATCH"><button>Update</button></Form>
  <Form method="delete"><button>Delete</button></Form>
</>;
// @ts-expect-error The form method is explicit.
const missingMethod = <Form />;
// @ts-expect-error Forms accept GET and the four mutation methods.
const unsupportedMethod = <Form method="head" />;
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
  clientAssetManifest: { entry: { file: "_goribu/assets/entry-1234ABCD.js" }, navigationBuildId: "1234567890abcdef1234567890abcdef" },
});
const response: Promise<Response> = app.fetch(new Request("https://app.test"), { GREETING: "Hello" }, { waitUntil() {} });
// @ts-expect-error Binding shape follows application configuration.
app.fetch(new Request("https://app.test"), {}, { waitUntil() {} });
// @ts-expect-error Raw config is unbranded and rejected by createApp.
createApp({ manifest: [], modules: new Map(), errorPages: { notFound: null }, applicationConfig: { name: "raw", compatibilityDate: "2026-08-31" } });

// Request diagnostics remain optional and never expose the thrown error.
function ErrorPage({ url, errorId, cfRay }: ServerErrorProps) {
  const ray: string | undefined = cfRay;
  return <main>{url} {errorId} {ray}</main>;
}
// @ts-expect-error The raw error is never a public page prop.
const rawError: ServerErrorProps["error"] = new Error("private");

// Upload policy functions are server-only and receive the normal typed request.
const uploadPolicies = {
  avatar: {
    accept: ["image/png", "image/*"], maxBytes: 5_000_000,
    key: ({ req, file, ext }) => `${req.params.id}/${file.size}${ext}`,
  },
} satisfies Record<string, import("goribu/server").UploadPolicy>;
const verifiedUpload: import("goribu/server").R2Upload = {
  key: "avatars/photo.png", name: "photo.png", type: "image/png", size: 123,
};
const publicUploadUrl: string | undefined = verifiedUpload.url;
void publicUploadUrl;
// @ts-expect-error A verified upload needs its stored byte size.
const incompleteUpload: import("goribu/server").R2Upload = { key: "key", name: "photo.png", type: "image/png" };
void incompleteUpload;
const invalidUploadKey: import("goribu/server").UploadPolicy = {
  accept: ["image/png"], maxBytes: 10,
  // @ts-expect-error Upload keys are synchronous strings.
  key: async () => "key",
};
void [uploadPolicies, invalidUploadKey];

const uploadUI = <Form method="patch" action="/avatar">{({ pending, uploading }) => <>
  <FileUpload name="avatar">{({ file, status, errorMessage, previewUrl, showPicker, dropProps }) =>
    <div {...dropProps}><button type="button" onClick={showPicker}>{file?.name}</button>
      {previewUrl && <img src={previewUrl} alt="" />}{status}{errorMessage}</div>}
  </FileUpload><button disabled={pending || uploading}>Save</button>
</>}</Form>;
const refPromise: Promise<string> = upload(new File(["x"], "photo.png"), { action: "/avatar", name: "avatar", signal: new AbortController().signal });
const uploadErrorCode: import("goribu").UploadErrorCode = new UploadError("network").code;
// @ts-expect-error A managed field has only a name and optional render function.
const multipleUpload = <FileUpload name="avatar" multiple />;
// @ts-expect-error A file is required; callers cannot forge metadata for the helper.
upload({ name: "photo.png", size: 1, type: "image/png" }, { action: "/avatar", name: "avatar" });
// @ts-expect-error An action route is required outside Form.
upload(new File([], "a"), { name: "avatar" });
