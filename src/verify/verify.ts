// `site2api verify`: calls every read-only tool against the live site and checks the response
// against the schema inferred from the recording. Write and auth operations are never called.
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { parseJson, type Exchange } from "../capture/har.js";
import type { Annotations } from "../infer/annotations.js";
import { graphqlCall } from "../normalize/graphql.js";
import { buildTools } from "../generate/tools.js";
import type { ToolDef } from "../generate/types.js";
import type { Schema } from "../normalize/schema.js";
import { HttpClient, pointerGet, safeJson, type Args, type Credentials } from "../runtime/http.js";
import type { Catalog, CatalogOperation } from "../spec/catalog.js";
import type { Operation } from "../spec/operations.js";

export type VerifyStatus = "pass" | "fail" | "skipped" | "error";

export interface VerifyResult {
  operationId: string;
  tool: string;
  status: VerifyStatus;
  httpStatus?: number;
  /** Where each input value came from: link, recording or user. Never the values themselves. */
  inputs?: Record<string, "link" | "recording" | "user">;
  errors?: string[];
  reason?: string;
}

export interface VerifyReport {
  version: 1;
  verifiedAt: string;
  baseUrl: string;
  summary: Record<VerifyStatus, number>;
  results: VerifyResult[];
}

export interface VerifyOptions {
  credentials: Credentials;
  baseUrl?: string;
  rate: number;
  /** Explicit inputs: operationId or tool name → input name → value. */
  inputs?: Record<string, Record<string, string>>;
  /** Operations from re-analyzing the original capture, used to replay recorded input values. */
  recorded?: Operation[];
  now?: () => Date;
}

export async function verify(catalog: Catalog, annotations: Annotations, options: VerifyOptions): Promise<VerifyReport> {
  const tools = buildTools(catalog, annotations, { allowWrites: false });
  const client = new HttpClient({
    recordedBaseUrl: tools.baseUrl,
    baseUrl: options.baseUrl,
    rate: options.rate,
    credentials: options.credentials,
    csrf: tools.csrf,
  });
  const byId = new Map(catalog.operations.map((op) => [op.id, op]));
  const bodies = new Map<string, unknown>(); // operationId → parsed response of a passing call
  const results = new Map<string, VerifyResult>();

  // Producers first: keep going while some tool's linked inputs became available.
  let pending = [...tools.tools];
  while (pending.length > 0) {
    const ready = pending.filter((t) => producersOf(t, catalog).every((p) => results.has(p) || !pending.some((q) => q.operationId === p)));
    const batch = ready.length > 0 ? ready : pending; // a cycle: just run the rest
    for (const tool of batch) {
      results.set(tool.operationId, await verifyTool(tool, byId.get(tool.operationId)!, catalog, client, bodies, options));
    }
    pending = pending.filter((t) => !results.has(t.operationId));
  }

  const ordered = tools.tools.map((t) => results.get(t.operationId)!);
  const summary: Record<VerifyStatus, number> = { pass: 0, fail: 0, skipped: 0, error: 0 };
  for (const r of ordered) summary[r.status]++;
  return {
    version: 1,
    verifiedAt: (options.now ?? (() => new Date()))().toISOString(),
    baseUrl: options.baseUrl ?? tools.baseUrl,
    summary,
    results: ordered,
  };
}

function producersOf(tool: ToolDef, catalog: Catalog): string[] {
  return catalog.links.filter((l) => l.to === tool.operationId).map((l) => l.from);
}

async function verifyTool(
  tool: ToolDef,
  op: CatalogOperation,
  catalog: Catalog,
  client: HttpClient,
  bodies: Map<string, unknown>,
  options: VerifyOptions,
): Promise<VerifyResult> {
  const base = { operationId: op.id, tool: tool.name };
  if (tool.auth.cookie && !options.credentials.cookie) return { ...base, status: "skipped", reason: "needs a session cookie" };
  if (tool.auth.bearer && !options.credentials.bearer) return { ...base, status: "skipped", reason: "needs a bearer token" };

  const { args, sources } = resolveInputs(op, tool, catalog, bodies, options);
  const missing = op.inputs.filter((i) => i.required && args[i.name] === undefined).map((i) => i.name);
  if (missing.length > 0) {
    return { ...base, status: "skipped", reason: `needs input: ${missing.join(", ")} (pass --input ${op.id}.${missing[0]}=…)` };
  }

  let res;
  try {
    res = await client.call(tool.http, args, tool.auth);
  } catch (err) {
    return { ...base, status: "error", inputs: sources, reason: err instanceof Error ? err.message : String(err) };
  }
  const withStatus = { ...base, httpStatus: res.status, inputs: sources };
  if (res.status === 401 || res.status === 403) return { ...withStatus, status: "error", reason: "not authorized: credentials missing or expired" };
  if (res.status >= 300 && res.status < 400) return { ...withStatus, status: "error", reason: "redirected (often to a login page)" };

  const schemaStatus = String(res.status);
  if (!(schemaStatus in op.responses)) {
    const recorded = Object.keys(op.responses).join(", ");
    return { ...withStatus, status: "fail", errors: [`unexpected HTTP ${res.status} (recorded: ${recorded})`] };
  }
  const schema = op.responses[schemaStatus];
  const body = safeJson(res.text);
  if (schema) {
    if (body === undefined) return { ...withStatus, status: "fail", errors: ["response is not JSON"] };
    const errors = schemaErrors(schema, body, op.samples);
    if (errors.length > 0) return { ...withStatus, status: "fail", errors };
  }
  bodies.set(op.id, body);
  return { ...withStatus, status: "pass" };
}

function resolveInputs(
  op: CatalogOperation,
  tool: ToolDef,
  catalog: Catalog,
  bodies: Map<string, unknown>,
  options: VerifyOptions,
): { args: Args; sources: Record<string, "link" | "recording" | "user"> } {
  const args: Args = {};
  const sources: Record<string, "link" | "recording" | "user"> = {};
  const recorded = recordedInputs(op, options.recorded);
  const explicit = { ...options.inputs?.[op.id], ...options.inputs?.[tool.name] };

  for (const input of op.inputs) {
    if (explicit[input.name] !== undefined) {
      args[input.name] = coerce(explicit[input.name]!, input.schema);
      sources[input.name] = "user";
      continue;
    }
    const link = catalog.links.find(
      (l) => l.to === op.id && l.target.in === input.in && (l.target.name === input.source || l.target.name === `/${input.source}`),
    );
    const linked = link && bodies.has(link.from) ? pointerGet(bodies.get(link.from), link.pointer) : undefined;
    if (linked !== undefined && linked !== null && typeof linked !== "object") {
      args[input.name] = linked;
      sources[input.name] = "link";
    } else if (recorded[input.name] !== undefined) {
      args[input.name] = recorded[input.name];
      sources[input.name] = "recording";
    }
  }
  return { args, sources };
}

/** Input values from the first recorded request of this operation. */
function recordedInputs(op: CatalogOperation, recorded: Operation[] | undefined): Args {
  const match = recorded?.find((r) =>
    op.graphql
      ? r.graphql?.operationName === op.graphql.operationName
      : !r.graphql && r.method === op.method && r.template === op.path && op.url.startsWith(r.origin),
  );
  const ex: Exchange | undefined = match?.exchanges[0];
  if (!ex) return {};

  const values: Args = {};
  for (const input of op.inputs) {
    if (input.in === "path") {
      const segs = ex.url.pathname.split("/").filter(Boolean);
      const idx = op.path.split("/").filter(Boolean).indexOf(`{${input.source}}`);
      if (idx >= 0 && segs[idx] !== undefined) values[input.name] = coerce(decodeURIComponent(segs[idx]!), input.schema);
    } else if (input.in === "query") {
      const v = ex.url.searchParams.get(input.source);
      if (v !== null) values[input.name] = coerce(v, input.schema);
    } else if (input.in === "variables") {
      const vars = graphqlCall(ex)?.variables ?? {};
      if (input.source === "") values[input.name] = vars;
      else if (vars[input.source] !== undefined) values[input.name] = vars[input.source];
    } else {
      const body = parseJson(ex.requestBody) as Args | undefined;
      if (input.source === "") values[input.name] = body;
      else if (body && body[input.source] !== undefined) values[input.name] = body[input.source];
    }
  }
  return values;
}

function coerce(value: string, schema: Schema): unknown {
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  if ((type === "integer" || type === "number") && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  if (type === "boolean" && (value === "true" || value === "false")) return value === "true";
  return value;
}

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const compiled = new WeakMap<object, ValidateFunction>();

export function schemaErrors(schema: Schema, body: unknown, samples: number): string[] {
  let validate = compiled.get(schema);
  if (!validate) compiled.set(schema, (validate = ajv.compile(schema)));
  if (validate(body)) return [];
  return (validate.errors ?? []).map((e) => describeError(e, body, samples));
}

function describeError(e: ErrorObject, body: unknown, samples: number): string {
  const path = e.instancePath || "/";
  if (e.keyword === "type") {
    return `${path}: expected ${[e.params.type].flat().join(" | ")}, got ${typeName(pointerGet(body, e.instancePath))}`;
  }
  if (e.keyword === "required") {
    const hint = samples < 3 ? ` (schema came from ${samples} sample(s); the field may be optional)` : "";
    return `${path === "/" ? "" : path}/${e.params.missingProperty}: missing${hint}`;
  }
  return `${path}: ${e.message ?? e.keyword}`;
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}
