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
import type { ToolDef, ToolsFile } from "../generate/types.js";
import { HttpClient, safeJson, type Args, type HttpResponse } from "./http.js";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const env = process.env;
const toolsPath = env.SITE2API_TOOLS ?? fileURLToPath(new URL("./tools.json", import.meta.url));
const file: ToolsFile = JSON.parse(readFileSync(toolsPath, "utf8"));
const maxBytes = Number(env.SITE2API_MAX_BYTES ?? 20000);

const client = new HttpClient({
  recordedBaseUrl: file.baseUrl,
  baseUrl: env.SITE2API_BASE_URL,
  rate: Number(env.SITE2API_RATE ?? 1),
  credentials: {
    cookie: env.SITE2API_COOKIE,
    bearer: env.SITE2API_BEARER,
    apiKeys: Object.fromEntries(
      file.tools.flatMap((t) => t.auth.apiKeys ?? []).flatMap((k) => (env[k.env] ? [[k.name, env[k.env]!]] : [])),
    ),
  },
  csrf: file.csrf,
});

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
  const missingKeys = (tool.auth.apiKeys ?? []).filter((k) => !env[k.env]).map((k) => k.env);
  if (missingKeys.length > 0) return error(`${tool.name} needs an API key: set ${missingKeys.join(", ")}.`);

  return render(await client.call(tool.http, args, tool.auth));
}

function render(res: HttpResponse): Result {
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

function error(text: string): Result {
  return { content: [{ type: "text", text }], isError: true };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
}

await server.connect(new StdioServerTransport());
