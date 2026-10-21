// The generated MCP server. Bundled with the MCP SDK into a single server.mjs at build time and
// copied next to tools.json by `site2api generate`, so users run it with plain `node`.
//
// Credentials come only from environment variables and are never written anywhere:
//   SITE2API_COOKIE    Cookie header copied from the browser (for cookie sessions)
//   SITE2API_BEARER    Bearer token (for token auth)
//   SITE2API_BASE_URL  Replace the recorded origin (e.g. a staging host or a local port)
//   SITE2API_RATE      Max requests per second (default 1)
//   SITE2API_MAX_BYTES Response text limit per call (default 20000)
//   SITE2API_TOOLS     Path to tools.json (default: next to this file)
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { HttpCall, ToolDef, ToolsFile } from "../generate/types.js";

type Args = Record<string, unknown>;
type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const env = process.env;
const toolsPath = env.SITE2API_TOOLS ?? fileURLToPath(new URL("./tools.json", import.meta.url));
const file: ToolsFile = JSON.parse(readFileSync(toolsPath, "utf8"));
const rate = Number(env.SITE2API_RATE ?? 1);
const maxBytes = Number(env.SITE2API_MAX_BYTES ?? 20000);

let csrfToken: string | undefined;
let nextSlot = 0;

const server = new Server(
  { name: `site2api-${slug(file.site.name)}`, version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: file.tools.map((t) => ({
    name: t.name,
    ...(t.title && { title: t.title }),
    description: t.description,
    inputSchema: t.inputSchema as { type: "object" },
    annotations: { readOnlyHint: t.kind === "read", destructiveHint: t.kind === "write", openWorldHint: true },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req): Promise<Result> => {
  const tool = file.tools.find((t) => t.name === req.params.name);
  if (!tool) return error(`Unknown tool ${req.params.name}.`);
  try {
    return await callTool(tool, (req.params.arguments ?? {}) as Args);
  } catch (err) {
    return error(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});

async function callTool(tool: ToolDef, args: Args): Promise<Result> {
  if (tool.kind === "write" && args.confirm !== true) {
    return error(
      `${tool.name} changes data on ${file.site.name}. Ask the user to approve this exact action, then call again with confirm: true.`,
    );
  }
  const required = (tool.inputSchema.required as string[] | undefined) ?? [];
  const missing = required.filter((name) => name !== "confirm" && args[name] === undefined);
  if (missing.length > 0) return error(`Missing required input(s): ${missing.join(", ")}.`);

  if (tool.auth.cookie && !env.SITE2API_COOKIE) {
    return error(`${tool.name} needs a logged-in session. Set SITE2API_COOKIE to the Cookie header from your browser.`);
  }
  if (tool.auth.bearer && !env.SITE2API_BEARER) return error(`${tool.name} needs SITE2API_BEARER to be set.`);

  const extra: Record<string, string> = {};
  if (tool.auth.csrf && file.csrf) {
    const token = csrfToken ?? (await fetchCsrf());
    if (token) extra[file.csrf.header] = token;
  }

  let res = await send(tool.http, args, tool.auth, extra);
  if (res.status === 403 && tool.auth.csrf && file.csrf?.source) {
    // The token may have rotated: refresh once and retry.
    csrfToken = undefined;
    const token = await fetchCsrf();
    if (token) res = await send(tool.http, args, tool.auth, { ...extra, [file.csrf.header]: token });
  }
  return render(res);
}

async function fetchCsrf(): Promise<string | undefined> {
  const source = file.csrf?.source;
  if (!source) return undefined;
  const res = await send(source.http, {}, { cookie: true, bearer: !!env.SITE2API_BEARER, csrf: false }, {});
  if (res.status >= 400) return undefined;
  const value = pointerGet(safeJson(res.text), source.pointer);
  csrfToken = typeof value === "string" ? value : undefined;
  return csrfToken;
}

interface Response {
  status: number;
  contentType: string;
  text: string;
}

async function send(http: HttpCall, args: Args, auth: ToolDef["auth"], extraHeaders: Record<string, string>): Promise<Response> {
  let url = http.url;
  if (env.SITE2API_BASE_URL && url.startsWith(file.baseUrl)) url = env.SITE2API_BASE_URL.replace(/\/$/, "") + url.slice(file.baseUrl.length);

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
  if (auth.cookie && env.SITE2API_COOKIE) headers.cookie = env.SITE2API_COOKIE;
  if (auth.bearer && env.SITE2API_BEARER) headers.authorization = `Bearer ${env.SITE2API_BEARER}`;

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
  await throttle();
  const res = await fetch(qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url, {
    method: http.method,
    headers,
    body: payload,
    redirect: "manual",
  });
  return { status: res.status, contentType: res.headers.get("content-type") ?? "", text: await res.text() };
}

function render(res: Response): Result {
  let text = res.text;
  const parsed = safeJson(text);
  if (parsed !== undefined) text = JSON.stringify(parsed, null, 2);
  if (text.length > maxBytes) text = `${text.slice(0, maxBytes)}\n… (truncated ${text.length - maxBytes} characters; narrow the request)`;
  const head = `HTTP ${res.status}`;
  if (res.status === 401 || res.status === 403) {
    return error(`${head}: not authorized. The session cookie or token may have expired; refresh SITE2API_COOKIE / SITE2API_BEARER from your browser.\n${text}`);
  }
  if (res.status >= 300 && res.status < 400) return error(`${head}: redirected (often to a login page). Check that the session is still valid.`);
  if (res.status >= 400) return error(`${head}\n${text}`);
  return { content: [{ type: "text", text: `${head}\n${text}` }] };
}

async function throttle() {
  if (!(rate > 0)) return;
  const now = Date.now();
  const wait = nextSlot - now;
  nextSlot = Math.max(now, nextSlot) + 1000 / rate;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

function pointerGet(value: unknown, pointer: string): unknown {
  let current = value;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) current = current[key === "*" ? 0 : Number(key)];
    else if (current && typeof current === "object") current = (current as Args)[key];
    else return undefined;
  }
  return current;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function error(text: string): Result {
  return { content: [{ type: "text", text }], isError: true };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
}

await server.connect(new StdioServerTransport());
