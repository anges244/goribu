import type { D1Database, D1DatabaseSession, KVNamespace, KVNamespaceListResult } from "@cloudflare/workers-types";
import type { FormErrors } from "./index.js";

export type ResponseHeaders = Record<string, string | string[]>;
export interface ApplicationConfig<Env extends object = Record<string, unknown>> {
  name: string;
  compatibilityDate: string;
  compatibilityFlags?: string[];
  database?: { type: "d1"; name: string; replication?: boolean };
  kv?: { name: string };
  responseHeaders?: (context: Readonly<{
    request: Request;
    env: Env;
    mode: "development" | "production";
    nonce: string;
  }>) => ResponseHeaders;
}
declare const configBrand: unique symbol;
export type DefinedConfig<Env extends object = Record<string, unknown>> =
  Readonly<Omit<ApplicationConfig<Env>, "compatibilityFlags" | "database" | "kv">> & {
    readonly compatibilityFlags: readonly string[];
    readonly database?: Readonly<NonNullable<ApplicationConfig<Env>["database"]>>;
    readonly kv?: Readonly<NonNullable<ApplicationConfig<Env>["kv"]>>;
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

export interface GoribuRequest<Env extends object = Record<string, unknown>, Params extends Record<keyof Params, string> = Record<string, string>> {
  method: string;
  path: string;
  params: Params;
  query: URLSearchParams;
  headers: Headers;
  env: Env;
  cookies: Cookies;
  d1: D1;
  kv: KV;
  waitUntil(promise: Promise<unknown>): void;
  /** Content-type-aware parsing; narrow and validate input before use. */
  body(): Promise<Record<string, unknown> | FormData | string>;
  rawBody(): Promise<Uint8Array>;
}
declare const resultBrand: unique symbol;
export interface ResponseResult { readonly [resultBrand]: true }
export interface GoribuResponse<Props extends object = Record<string, unknown>> {
  status(code: number): this;
  headers(headers: ResponseHeaders): this;
  text(body?: unknown): ResponseResult;
  json(data: unknown): ResponseResult;
  invalid(errors: string | FormErrors, status?: number): ResponseResult;
  redirect(location: string): ResponseResult;
  render(...args: {} extends Props ? [props?: Props] : [props: Props]): ResponseResult;
  notFound(props?: Record<string, unknown>): ResponseResult;
}
export type Handler<Props extends object = Record<string, unknown>, Env extends object = Record<string, unknown>, Params extends Record<keyof Params, string> = Record<string, string>> =
  (req: GoribuRequest<Env, Params>, res: GoribuResponse<Props>) => ResponseResult | Promise<ResponseResult>;
export type Middleware<Env extends object = Record<string, unknown>> =
  (req: GoribuRequest<Env>, res: GoribuResponse) => ResponseResult | void | Promise<ResponseResult | void>;

export interface ServerErrorProps { errorId: string; url: string }
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
}
export function createApp<Env extends object = Record<string, unknown>>(options: AppOptions<Env>): WorkerApp<Env>;

export {};
