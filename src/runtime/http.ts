// Turns a tool's HttpCall plus arguments into a real request. Shared by the generated MCP server
// and by `site2api verify`, so what verify checks is exactly what the server sends.
import type { HttpCall, ToolAuth, ToolsFile } from "../generate/types.js";
import { siteOf } from "../normalize/filter.js";

export type Args = Record<string, unknown>;

export interface Credentials {
  cookie?: string;
  bearer?: string;
  /** API key values by header or query parameter name. */
  apiKeys?: Record<string, string>;
}

export interface HttpResponse {
  status: number;
  contentType: string;
  text: string;
  /** The body was longer than maxResponseBytes and was cut there. */
  truncated?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export interface HttpClientOptions {
  /** Origin the URLs were recorded against. */
  recordedBaseUrl: string;
  /** Replaces recordedBaseUrl, e.g. a staging host or a local port. */
  baseUrl?: string;
  /** Max requests per second; 0 disables the limit. */
  rate: number;
  credentials: Credentials;
  csrf?: ToolsFile["csrf"];
  /** Per request, default 30 s. */
  timeoutMs?: number;
  /** Bodies are read up to this many bytes, default 10 MB. */
  maxResponseBytes?: number;
}

/** `--rate` and `HttpClient` share this. `0` turns the limit off; anything else must be finite and >= 0. */
export function parseRate(raw: string | number, label = "rate"): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite number >= 0, not "${raw}"`);
  return value;
}

export class HttpClient {
  private csrfToken: string | undefined;
  private nextSlot = 0;

  constructor(private readonly options: HttpClientOptions) {
    parseRate(options.rate);
  }

  /** Adds API key values (verify learns them per operation, from env or the recording). */
  setApiKeys(apiKeys: Record<string, string>): void {
    this.options.credentials.apiKeys = { ...this.options.credentials.apiKeys, ...apiKeys };
  }

  /** Sends the call, adding a CSRF token when needed and refreshing it once on 403. */
  async call(http: HttpCall, args: Args, auth: ToolAuth): Promise<HttpResponse> {
    const csrf = this.options.csrf;
    const extra: Record<string, string> = {};
    if (auth.csrf && csrf) {
      const token = this.csrfToken ?? (await this.fetchCsrf());
      if (token) extra[csrf.header] = token;
    }
    let res = await this.send(http, args, auth, extra);
    if (res.status === 403 && auth.csrf && csrf?.source) {
      // The token may have rotated: refresh once and retry.
      this.csrfToken = undefined;
      const token = await this.fetchCsrf();
      if (token) res = await this.send(http, args, auth, { ...extra, [csrf.header]: token });
    }
    return res;
  }

  private async fetchCsrf(): Promise<string | undefined> {
    const source = this.options.csrf?.source;
    if (!source) return undefined;
    const res = await this.send(source.http, {}, { cookie: true, bearer: !!this.options.credentials.bearer, csrf: false, apiKeys: [] }, {});
    if (res.status >= 400) return undefined;
    const value = pointerGet(safeJson(res.text), source.pointer);
    this.csrfToken = typeof value === "string" ? value : undefined;
    return this.csrfToken;
  }

  async send(http: HttpCall, args: Args, auth: ToolAuth, extraHeaders: Record<string, string>): Promise<HttpResponse> {
    const { recordedBaseUrl, baseUrl, credentials } = this.options;
    let url = http.url;
    const recorded = recordedBaseUrl.replace(/\/$/, "");
    if (baseUrl && (url === recorded || url.startsWith(`${recorded}/`))) url = baseUrl.replace(/\/$/, "") + url.slice(recorded.length);

    const query = new URLSearchParams();
    const body: Args = {};
    let wholeBody: unknown;
    for (const input of http.inputs) {
      // Own properties only: an input named `constructor` must not read Object.prototype.
      const value = (Object.hasOwn(args, input.name) ? args[input.name] : undefined) ?? input.default;
      if (value === undefined) continue;
      if (input.in === "path") url = url.replace(`{${input.source}}`, pathSegment(input.name, value));
      else if (input.in === "query") query.append(input.source, String(value));
      else if (input.source === "") wholeBody = value;
      else body[input.source] = value;
    }

    const headers: Record<string, string> = { accept: "application/json", ...extraHeaders };
    // The session cookie and token belong to the site they were copied from. An operation on
    // another site (an extra recorded origin) never gets them. API keys are per operation already.
    if (this.sameSite(url)) {
      if (auth.cookie && credentials.cookie) headers.cookie = credentials.cookie;
      if (auth.bearer && credentials.bearer) headers.authorization = `Bearer ${credentials.bearer}`;
    }
    for (const key of auth.apiKeys ?? []) {
      const value = credentials.apiKeys?.[key.name];
      if (value === undefined) continue;
      if (key.in === "header") headers[key.name] = value;
      else query.set(key.name, value);
    }

    let payload: string | undefined;
    if (http.graphql) {
      const variables = wholeBody ?? (Object.keys(body).length > 0 ? body : undefined);
      const gql = { operationName: http.graphql.operationName, query: http.graphql.query, ...(variables !== undefined && { variables }) };
      if (http.method === "GET") {
        query.set("query", gql.query);
        query.set("operationName", gql.operationName);
        if (variables !== undefined) query.set("variables", JSON.stringify(variables));
      } else {
        payload = JSON.stringify(gql);
        headers["content-type"] = "application/json";
      }
    } else if (http.bodyType) {
      const data = wholeBody ?? body;
      if (http.bodyType === "application/x-www-form-urlencoded") {
        payload = new URLSearchParams(Object.entries(data as Args).map(([k, v]) => [k, String(v)])).toString();
      } else {
        payload = JSON.stringify(data);
      }
      headers["content-type"] = http.bodyType;
    }

    const qs = query.toString();
    await this.throttle();
    const target = qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const signal = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await fetch(target, { method: http.method, headers, body: payload, redirect: "manual", signal });
    } catch (err) {
      throw new Error(networkErrorMessage(err, target, timeoutMs));
    }
    let received;
    try {
      received = await readCapped(res, this.options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
    } catch (err) {
      throw new Error(networkErrorMessage(err, target, timeoutMs));
    }
    return { status: res.status, contentType: res.headers.get("content-type") ?? "", ...received };
  }

  private sameSite(url: string): boolean {
    const primary = new URL(this.options.baseUrl ?? this.options.recordedBaseUrl).hostname;
    return siteOf(new URL(url).hostname) === siteOf(primary);
  }

  private async throttle() {
    const { rate } = this.options;
    if (!(rate > 0)) return;
    const now = Date.now();
    const wait = this.nextSlot - now;
    this.nextSlot = Math.max(now, this.nextSlot) + 1000 / rate;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

const NETWORK_REASONS: Record<string, string> = {
  ECONNREFUSED: "connection refused",
  ENOTFOUND: "host not found",
  EAI_AGAIN: "DNS lookup failed",
  ECONNRESET: "connection reset",
  ETIMEDOUT: "timed out",
  UND_ERR_CONNECT_TIMEOUT: "timed out",
  CERT_HAS_EXPIRED: "TLS certificate expired",
  DEPTH_ZERO_SELF_SIGNED_CERT: "self-signed TLS certificate",
};

/**
 * A path argument fills one segment. `.`, `..`, a slash, or an encoded slash would make the URL
 * point somewhere else on servers that decode `%2F` and then normalize `.`.
 */
function pathSegment(name: string, value: unknown): string {
  const text = String(value);
  if (text === "" || text === "." || text.includes("/") || text.includes("\\") || text.includes("..") || /%(?:2e|2f)/i.test(text)) {
    throw new Error(`input ${name} cannot be "${text}": it is part of the URL path`);
  }
  return encodeURIComponent(text);
}

/** Reads the body up to a byte limit, so one huge response cannot exhaust memory. */
async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated?: boolean }> {
  if (!res.body) return { text: "" };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  return truncated ? { text, truncated } : { text };
}

/** fetch() only says "fetch failed"; the useful part is in err.cause. */
export function networkErrorMessage(err: unknown, url: string, timeoutMs?: number): string {
  if ((err as { name?: string })?.name === "TimeoutError") {
    return `${new URL(url).origin} did not answer within ${Math.round((timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} s`;
  }
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  const code = cause?.code ?? "";
  const reason = NETWORK_REASONS[code] ?? cause?.message ?? (err instanceof Error ? err.message : String(err));
  return `could not reach ${new URL(url).origin} (${reason}). Is the site up, and is the base URL right? (SITE2API_BASE_URL / --base-url)`;
}

/** JSON pointer lookup where `*` means "first array element". */
export function pointerGet(value: unknown, pointer: string): unknown {
  let current = value;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) current = current[key === "*" ? 0 : Number(key)];
    else if (current && typeof current === "object") current = (current as Args)[key];
    else return undefined;
  }
  return current;
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
