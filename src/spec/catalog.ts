// Reads a generated openapi.yaml back into a flat list of callable operations.
// This is the shared view for the Infer stage (context.md) and the Generate stage (tools.json),
// so both agree on operation ids and on the names of each operation's inputs.
import type { Schema } from "../normalize/schema.js";

export type InputIn = "path" | "query" | "body" | "variables";

export interface CatalogInput {
  /** Name the tool exposes. Body fields that collide with a parameter get a `body_` prefix. */
  name: string;
  in: InputIn;
  /** Original parameter name or top-level body/variables key. Empty when the whole body is one input. */
  source: string;
  required: boolean;
  schema: Schema;
}

export interface CatalogAuth {
  bearer: boolean;
  cookies: string[];
  headers: string[];
}

export interface CatalogOperation {
  id: string;
  summary?: string;
  protocol: "rest" | "graphql";
  method: string;
  /** Absolute URL template, e.g. http://localhost:4317/api/orders/{orderId} */
  url: string;
  path: string;
  inputs: CatalogInput[];
  bodyType?: "application/json" | "application/x-www-form-urlencoded";
  graphql?: { operationName: string; operationType: string; query: string };
  responses: Record<string, Schema | undefined>;
  auth: CatalogAuth;
  writes: boolean;
  /** Sets the session cookie: a login-style operation. */
  setsSession: boolean;
  samples: number;
}

export interface CatalogLink {
  from: string;
  status: number;
  pointer: string;
  to: string;
  target: { in: string; name: string };
  matches: number;
  samples: number;
}

export interface Catalog {
  title: string;
  site: string;
  baseUrl: string;
  operations: CatalogOperation[];
  links: CatalogLink[];
  auth: {
    session?: { cookies: string[]; setBy: string[] };
    csrf?: { header: string; source?: { operationId: string; status: number; pointer: string } };
    bearer?: { source?: { operationId: string; status: number; pointer: string } };
  };
}

type Json = Record<string, any>;
const METHODS = ["get", "post", "put", "patch", "delete"];

export function readCatalog(spec: Json): Catalog {
  const baseUrl: string = spec.servers?.[0]?.url ?? "";
  const schemes: Json = spec.components?.securitySchemes ?? {};
  const auth = spec["x-site2api-auth"] ?? {};
  const setBy = new Set<string>(auth.session?.setBy ?? []);
  const operations: CatalogOperation[] = [];

  for (const [path, item] of Object.entries<Json>(spec.paths ?? {})) {
    const origin: string = item.servers?.[0]?.url ?? baseUrl;
    for (const method of METHODS) {
      const op: Json | undefined = item[method];
      if (!op || op["x-site2api"]?.graphqlEndpoint) continue;
      const inputs: CatalogInput[] = (op.parameters ?? []).map((p: Json) => ({
        name: p.name,
        in: p.in,
        source: p.name,
        required: !!p.required,
        schema: p.schema ?? {},
      }));
      const content: Json = op.requestBody?.content ?? {};
      const bodyType = (["application/json", "application/x-www-form-urlencoded"] as const).find((t) => content[t]);
      if (bodyType) addObjectInputs(inputs, "body", content[bodyType].schema ?? {}, !!op.requestBody.required);

      operations.push({
        id: op.operationId,
        summary: op.summary,
        protocol: "rest",
        method: method.toUpperCase(),
        url: origin + path,
        path,
        inputs,
        bodyType,
        responses: Object.fromEntries(
          Object.entries<Json>(op.responses ?? {}).map(([status, r]) => [status, r.content?.["application/json"]?.schema]),
        ),
        auth: authOf(op.security, schemes),
        writes: !!op["x-site2api"]?.writes,
        setsSession: setBy.has(op.operationId),
        samples: op["x-site2api"]?.samples ?? 0,
      });
    }
  }

  for (const g of spec["x-site2api-graphql"] ?? []) {
    const inputs: CatalogInput[] = [];
    if (g.variables) addObjectInputs(inputs, "variables", g.variables, true);
    operations.push({
      id: g.operationId,
      summary: `${g.operationType} ${g.operationName}`,
      protocol: "graphql",
      method: g.endpoint.method,
      url: g.endpoint.url,
      path: new URL(g.endpoint.url).pathname,
      inputs,
      bodyType: g.endpoint.method === "POST" ? "application/json" : undefined,
      graphql: { operationName: g.operationName, operationType: g.operationType, query: g.query },
      responses: { "200": g.response },
      auth: authOf(g.security, schemes),
      writes: !!g["x-site2api"]?.writes,
      setsSession: setBy.has(g.operationId),
      samples: g["x-site2api"]?.samples ?? 0,
    });
  }

  return {
    title: spec.info?.title ?? "",
    site: String(spec.info?.title ?? "").replace(/ \(reverse-engineered\)$/, ""),
    baseUrl,
    operations,
    links: spec["x-site2api-links"] ?? [],
    auth,
  };
}

function addObjectInputs(inputs: CatalogInput[], where: "body" | "variables", schema: Schema, required: boolean) {
  if (schema.type === "object" && schema.properties) {
    const taken = new Set(inputs.map((i) => i.name));
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      inputs.push({
        name: taken.has(key) ? `body_${key}` : key,
        in: where,
        source: key,
        required: required && (schema.required ?? []).includes(key),
        schema: propSchema,
      });
    }
  } else {
    inputs.push({ name: where, in: where, source: "", required, schema });
  }
}

function authOf(security: Json[] | undefined, schemes: Json): CatalogAuth {
  const result: CatalogAuth = { bearer: false, cookies: [], headers: [] };
  for (const name of Object.keys(security?.[0] ?? {})) {
    const scheme = schemes[name];
    if (!scheme) continue;
    if (scheme.type === "http" && scheme.scheme === "bearer") result.bearer = true;
    else if (scheme.in === "cookie") result.cookies.push(scheme.name);
    else if (scheme.in === "header") result.headers.push(scheme.name);
  }
  return result;
}

/** Default classification before the agent weighs in. */
export function defaultKind(op: CatalogOperation): "read" | "write" | "auth" {
  if (op.setsSession) return "auth";
  return op.writes ? "write" : "read";
}
