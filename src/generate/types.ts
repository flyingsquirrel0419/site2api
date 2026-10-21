// tools.json: everything the generated MCP server needs, as data. The runtime (src/runtime/server.ts)
// is fixed code that interprets this file, so generation never writes per-tool code.

export interface ToolInput {
  name: string;
  in: "path" | "query" | "body" | "variables";
  /** Original parameter name or top-level body key. Empty when the input is the whole body. */
  source: string;
}

export interface HttpCall {
  method: string;
  /** Absolute URL template with {param} placeholders. */
  url: string;
  inputs: ToolInput[];
  bodyType?: "application/json" | "application/x-www-form-urlencoded";
  graphql?: { operationName: string; query: string };
}

export interface ToolAuth {
  cookie: boolean;
  bearer: boolean;
  csrf: boolean;
}

export interface ToolDef {
  name: string;
  title?: string;
  description: string;
  operationId: string;
  kind: "read" | "write";
  inputSchema: Record<string, unknown>;
  http: HttpCall;
  auth: ToolAuth;
  /** Outcome of `site2api verify` for this tool; absent when never verified (e.g. writes). */
  verified?: "pass" | "fail" | "skipped" | "error";
}

export interface ToolsFile {
  version: 1;
  site: { name: string; description?: string };
  /** Origin the URLs were recorded against; SITE2API_BASE_URL replaces it at runtime. */
  baseUrl: string;
  csrf?: {
    header: string;
    /** Request that returns the token, and where in its JSON response the token is. */
    source?: { http: HttpCall; pointer: string };
  };
  tools: ToolDef[];
  skipped: { operationId: string; reason: string }[];
}
