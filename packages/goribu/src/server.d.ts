import type { Sql } from "postgres";
import type { D1Database, D1DatabaseSession, KVNamespace, KVNamespaceListResult, R2Bucket, R2Object, R2ObjectBody, R2GetOptions, R2PutOptions, R2MultipartOptions, R2MultipartUpload } from "@cloudflare/workers-types";
import type { FormErrors } from "./index.js";

export type ResponseHeaders = Record<string, string | string[]>;
type WranglerJson = string | number | boolean | null | readonly WranglerJson[] | { readonly [key: string]: WranglerJson };
/** Wrangler fields Goribu writes or owns; the build rejects them with the reason. */
type ReservedWranglerField =
  | "name" | "main" | "compatibility_date" | "compatibility_flags" | "assets" | "workers_dev" | "preview_urls" | "account_id"
  | "d1_databases" | "kv_namespaces" | "r2_buckets" | "hyperdrive"
  | "routes" | "route" | "env" | "previews" | "compliance_region" | "pages_build_output_dir"
  | "dev" | "alias" | "define" | "minify" | "base_dir" | "build" | "find_additional_modules" | "no_bundle" | "preserve_file_names" | "rules" | "site" | "tsconfig"
  | "triggers" | "migrations" | "exports" | "containers" | "cloudchamber" | "placement" | "unsafe" | "unsafe_hello_world";
/** Native Wrangler configuration fields, as JSON, merged into the generated config. */
type WranglerConfig = { readonly [key: string]: WranglerJson } & { readonly [Field in ReservedWranglerField]?: never };
export interface ApplicationConfig<Env extends object = Record<string, unknown>> {
  name: string;
  domain?: string;
  workersDev?: boolean;
  compatibilityDate: string;
  compatibilityFlags?: string[];
  database?:
    | { type: "d1"; name: string; replication?: boolean }
    | ({ type: "postgres" } & (
      | { hyperdriveId: string; hyperdriveCachedId: string }
      | { hyperdriveId?: never; hyperdriveCachedId?: never }
    ));
  kv?: { name: string };
  r2?: {
    name: string;
    domain?: string;
    private?: { name: string };
    jurisdiction?: "eu";
  };
  wrangler?: WranglerConfig;
  responseHeaders?: (context: Readonly<{
    request: Request;
    env: Env;
    mode: "development" | "production";
    nonce: string;
  }>) => ResponseHeaders;
}
declare const configBrand: unique symbol;
export type DefinedConfig<Env extends object = Record<string, unknown>> =
  Readonly<Omit<ApplicationConfig<Env>, "workersDev" | "compatibilityFlags" | "database" | "kv" | "r2">> & {
    readonly workersDev: boolean;
    readonly compatibilityFlags: readonly string[];
    readonly database?: Readonly<NonNullable<ApplicationConfig<Env>["database"]>>;
    readonly kv?: Readonly<NonNullable<ApplicationConfig<Env>["kv"]>>;
    readonly r2?: Readonly<Omit<NonNullable<ApplicationConfig<Env>["r2"]>, "private">> & {
      readonly private?: Readonly<{ name: string }>;
    };
    readonly [configBrand]: true;
  };
export function defineConfig<Env extends object = Record<string, unknown>>(
  config: ApplicationConfig<Env> | DefinedConfig<Env>,
): DefinedConfig<Env>;

export interface CookieOptions {
  domain?: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none" | "Lax" | "Strict" | "None";
}
export interface Cookies {
  get(name: string): string | null;
  set(name: string, value: string, options?: CookieOptions): void;
  delete(name: string, options?: Pick<CookieOptions, "domain" | "path">): void;
}

export type D1Value = string | number | boolean | null | ArrayBuffer | ArrayBufferView;
export interface D1WriteResult {
  changes: number | undefined;
  lastRowId: number | undefined;
}
export interface D1Statement<Row extends object = Record<string, unknown>> {
  get(): Promise<Row | null>;
  all(): Promise<Row[]>;
  value<Value = unknown>(): Promise<Value | null>;
  run(): Promise<D1WriteResult>;
  /** Awaiting a statement without a terminal method rejects at runtime. */
  then(resolve: (value: never) => unknown, reject: (error: Error) => unknown): void;
}
export interface D1Queries {
  <Row extends object = Record<string, unknown>>(strings: TemplateStringsArray, ...values: Array<D1Value | D1Value[]>): D1Statement<Row>;
  unsafe<Row extends object = Record<string, unknown>>(text: string, params?: D1Value[]): D1Statement<Row>;
  readonly binding: D1Database;
  /** With replication disabled, this is the raw binding. */
  readonly session: D1DatabaseSession | D1Database;
}
export interface D1 extends D1Queries {
  readonly fresh: D1Queries;
  readonly public: D1Queries;
  atomic<Statements extends D1Statement<object>[]>(statements: [...Statements]): Promise<{
    [Index in keyof Statements]: D1WriteResult & {
      rows: Statements[Index] extends D1Statement<infer Row> ? Row[] : never;
    };
  }>;
}

type KVOptions = { cacheTtl?: number };
type KVWithMetadata<Value, Metadata> = { value: Value | null; metadata: Metadata | null; cacheStatus: string | null };
export interface KV {
  get<Json = unknown, Metadata = unknown>(key: string, options: KVOptions & { type: "json"; metadata: true }): Promise<KVWithMetadata<Json, Metadata>>;
  get<Metadata = unknown>(key: string, options: KVOptions & { type: "arrayBuffer"; metadata: true }): Promise<KVWithMetadata<ArrayBuffer, Metadata>>;
  get<Metadata = unknown>(key: string, options: KVOptions & { type: "stream"; metadata: true }): Promise<KVWithMetadata<ReadableStream<Uint8Array>, Metadata>>;
  get<Metadata = unknown>(key: string, options: KVOptions & { type?: "text"; metadata: true }): Promise<KVWithMetadata<string, Metadata>>;
  get<Json = unknown>(key: string, options: KVOptions & { type: "json"; metadata?: false }): Promise<Json | null>;
  get(key: string, options: KVOptions & { type: "arrayBuffer"; metadata?: false }): Promise<ArrayBuffer | null>;
  get(key: string, options: KVOptions & { type: "stream"; metadata?: false }): Promise<ReadableStream<Uint8Array> | null>;
  get(key: string, options?: KVOptions & { type?: "text"; metadata?: false }): Promise<string | null>;
  put: KVNamespace["put"];
  list<Metadata = unknown>(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<KVNamespaceListResult<Metadata>>;
  delete(key: string): Promise<void>;
}

/**
 * Best-effort JSON cache scoped to the request origin and execution location.
 * Keys are literal strings starting with "/". Platform failures become misses
 * or no-ops; entries may be evicted before their TTL expires.
 */
export interface GoribuCache {
  /** The optional type argument describes the stored JSON; it does not validate it. */
  get<Value = unknown>(key: string): Promise<Value | null>;
  /** JSON serialization must succeed. TTL is a positive safe integer in seconds, defaulting to 60. */
  set(key: string, value: unknown, options?: { ttl?: number }): Promise<void>;
  /** Deletes the named keys only at the current execution location. */
  delete(...keys: string[]): Promise<void>;
}

// Workers and DOM Web types differ structurally. Accept both for application
// File/Blob/Headers values while retaining native options and return types.
type R2PutValue = Parameters<R2Bucket["put"]>[1] | Blob | ReadableStream;
type R2WebOptions<T> = { [K in keyof T]: K extends "httpMetadata" | "onlyIf" ? T[K] | Headers : T[K] };
interface R2WebMultipartUpload extends R2MultipartUpload {
  uploadPart(partNumber: number, value: Parameters<R2MultipartUpload["uploadPart"]>[1] | Blob | ReadableStream, options?: Parameters<R2MultipartUpload["uploadPart"]>[2]): ReturnType<R2MultipartUpload["uploadPart"]>;
}
export interface GoribuR2Bucket extends R2Bucket {
  /** Immutable links reuse half-lifetime windows and allow private caching until expiry.
   * Use only for fixed contents; remaining validity at issuance is at least half of expiresIn.
   */
  signedUrl(key: string, options?: { expiresIn?: number; download?: string; immutable?: boolean }): Promise<string>;
  get(key: string, options: R2WebOptions<R2GetOptions> & { onlyIf: NonNullable<R2WebOptions<R2GetOptions>["onlyIf"]> }): Promise<R2ObjectBody | R2Object | null>;
  get(key: string, options?: R2WebOptions<R2GetOptions>): Promise<R2ObjectBody | null>;
  put(key: string, value: R2PutValue, options?: R2WebOptions<R2PutOptions> & { onlyIf: NonNullable<R2WebOptions<R2PutOptions>["onlyIf"]> }): Promise<R2Object | null>;
  put(key: string, value: R2PutValue, options?: R2WebOptions<R2PutOptions>): Promise<R2Object>;
  createMultipartUpload(key: string, options?: R2WebOptions<R2MultipartOptions>): Promise<R2WebMultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): R2WebMultipartUpload;
}

export interface GoribuR2 extends GoribuR2Bucket {
  url(key: string): string;
  readonly private: GoribuR2Bucket;
}

/** A declared upload field after signed-ref and stored-object verification. */
export interface R2Upload {
  key: string;
  name: string;
  type: string;
  size: number;
  /** Present only for a public default bucket. */
  url?: string;
}

/** Server-only policy exported from an upload action route. */
export interface UploadPolicy<Env extends object = Record<string, unknown>, Params extends Record<keyof Params, string> = Record<string, string>> {
  accept: readonly string[];
  maxBytes: number;
  private?: boolean;
  direct?: boolean;
  key?: (context: {
    req: GoribuRequest<Env, Params>;
    file: Readonly<{ name: string; type: string; size: number }>;
    ext: string;
  }) => string;
}

/**
 * Fields the app attaches to `req` in middleware for later middleware and the
 * handler. Declare them by augmenting this interface:
 * `declare module "goribu/server" { interface AppRequestFields { user?: User } }`.
 */
export interface AppRequestFields {}
export interface GoribuRequest<Env extends object = Record<string, unknown>, Params extends Record<keyof Params, string> = Record<string, string>> extends AppRequestFields {
  method: string;
  /** The absolute route URL, such as for building an OAuth callback from `url.origin`. */
  url: URL;
  path: string;
  params: Params;
  query: URLSearchParams;
  headers: Headers;
  env: Env;
  cookies: Cookies;
  d1: D1;
  kv: KV;
  cache: GoribuCache;
  r2: GoribuR2;
  /** Postgres.js over the POSTGRES Hyperdrive binding, with query caching disabled. Created on first use in each request. */
  readonly postgres: Sql;
  /** Postgres.js over the POSTGRES_CACHED binding; Hyperdrive may answer reads from its cache. */
  readonly postgresCached: Sql;
  waitUntil(promise: Promise<unknown>): void;
  /**
   * JSON and forms return objects. Declared upload fields become verified
   * R2Upload values or are absent. Other file inputs remain Files and repeated
   * form fields remain arrays. Other content types return {}. Narrow values before use.
   */
  body(): Promise<Record<string, unknown>>;
  rawBody(): Promise<Uint8Array>;
}
declare const resultBrand: unique symbol;
export interface ResponseResult { readonly [resultBrand]: true }
export interface GoribuResponse<Props extends object = Record<string, unknown>> {
  status(code: number): this;
  headers(headers: ResponseHeaders): this;
  text(body?: unknown): ResponseResult;
  json(data: unknown): ResponseResult;
  /** Send binary or streamed bytes, such as an R2 object's body. Content type defaults to application/octet-stream. */
  stream(body: ReadableStream | ArrayBuffer | ArrayBufferView | Blob): ResponseResult;
  invalid(errors: string | FormErrors, status?: number): ResponseResult;
  redirect(location: string): ResponseResult;
  render(...args: {} extends Props ? [props?: Props] : [props: Props]): ResponseResult;
  notFound(props?: Record<string, unknown>): ResponseResult;
}
export type Handler<Props extends object = Record<string, unknown>, Env extends object = Record<string, unknown>, Params extends Record<keyof Params, string> = Record<string, string>> =
  (req: GoribuRequest<Env, Params>, res: GoribuResponse<Props>) => ResponseResult | Promise<ResponseResult>;
export type Middleware<Env extends object = Record<string, unknown>> =
  (req: GoribuRequest<Env>, res: GoribuResponse) => ResponseResult | void | Promise<ResponseResult | void>;

export interface ServerErrorProps { errorId: string; url: string; cfRay?: string }
export interface WorkerContext { waitUntil(promise: Promise<unknown>): void }
export interface WorkerApp<Env extends object = Record<string, unknown>> {
  fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response>;
}
export interface RouteManifestEntry {
  id: string;
  pattern: string;
  segments: Array<{ type: "static"; value: string } | { type: "dynamic"; name: string }>;
  hasDefaultExport: boolean;
  methods: string[];
  prerenderOverride?: boolean | null;
  prerenderEligible: boolean;
  filePath?: string;
}
export interface ClientAsset {
  file: string;
  imports?: string[];
  css?: string[];
}
/** Inputs are prepared by goribu/vite; ordinary apps do not construct this map. */
export interface AppOptions<Env extends object = Record<string, unknown>> {
  manifest: RouteManifestEntry[];
  modules: Map<string, object>;
  errorPages: { notFound: string | null; serverError?: string | null };
  documentId?: string | null;
  middlewareByRoute?: Map<string, Array<{ id: string; relativePath: string }>>;
  mode?: "development" | "production";
  clientAssetManifest?: { entry: ClientAsset; pages?: Record<string, ClientAsset>; navigationBuildId?: string } | null;
  clientAssetBase?: string;
  applicationConfig?: DefinedConfig<Env>;
  postgres?: (env: Env) => { fresh(): Sql; cached(): Sql };
}
export function createApp<Env extends object = Record<string, unknown>>(options: AppOptions<Env>): WorkerApp<Env>;

export {};
