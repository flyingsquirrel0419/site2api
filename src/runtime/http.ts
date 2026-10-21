// Turns a tool's HttpCall plus arguments into a real request. Shared by the generated MCP server
// and by `site2api verify`, so what verify checks is exactly what the server sends.
import type { HttpCall, ToolAuth, ToolsFile } from "../generate/types.js";

export type Args = Record<string, unknown>;

export interface Credentials {
  cookie?: string;
  bearer?: string;
}

export interface HttpResponse {
  status: number;
  contentType: string;
  text: string;
}

export interface HttpClientOptions {
  /** Origin the URLs were recorded against. */
  recordedBaseUrl: string;
  /** Replaces recordedBaseUrl, e.g. a staging host or a local port. */
  baseUrl?: string;
  /** Max requests per second; 0 disables the limit. */
  rate: number;
  credentials: Credentials;
  csrf?: ToolsFile["csrf"];
}

export class HttpClient {
  private csrfToken: string | undefined;
  private nextSlot = 0;

  constructor(private readonly options: HttpClientOptions) {}

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
    const res = await this.send(source.http, {}, { cookie: true, bearer: !!this.options.credentials.bearer, csrf: false }, {});
    if (res.status >= 400) return undefined;
    const value = pointerGet(safeJson(res.text), source.pointer);
    this.csrfToken = typeof value === "string" ? value : undefined;
    return this.csrfToken;
  }

  async send(http: HttpCall, args: Args, auth: ToolAuth, extraHeaders: Record<string, string>): Promise<HttpResponse> {
    const { recordedBaseUrl, baseUrl, credentials } = this.options;
    let url = http.url;
    if (baseUrl && url.startsWith(recordedBaseUrl)) url = baseUrl.replace(/\/$/, "") + url.slice(recordedBaseUrl.length);

    const query = new URLSearchParams();
    const body: Args = {};
    let wholeBody: unknown;
    for (const input of http.inputs) {
      const value = args[input.name];
      if (value === undefined) continue;
      if (input.in === "path") url = url.replace(`{${input.source}}`, encodeURIComponent(String(value)));
      else if (input.in === "query") query.append(input.source, String(value));
      else if (input.source === "") wholeBody = value;
      else body[input.source] = value;
    }

    const headers: Record<string, string> = { accept: "application/json", ...extraHeaders };
    if (auth.cookie && credentials.cookie) headers.cookie = credentials.cookie;
    if (auth.bearer && credentials.bearer) headers.authorization = `Bearer ${credentials.bearer}`;

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
    let res: Response;
    try {
      res = await fetch(target, { method: http.method, headers, body: payload, redirect: "manual" });
    } catch (err) {
      throw new Error(networkErrorMessage(err, target));
    }
    return { status: res.status, contentType: res.headers.get("content-type") ?? "", text: await res.text() };
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

/** fetch() only says "fetch failed"; the useful part is in err.cause. */
export function networkErrorMessage(err: unknown, url: string): string {
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
