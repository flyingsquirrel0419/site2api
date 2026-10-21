import { parseJson, type Exchange } from "../capture/har.js";

export interface GraphqlCall {
  operationName: string;
  operationType: "query" | "mutation" | "subscription";
  query: string;
  variables?: Record<string, unknown>;
}

const OPERATION_RE = /^\s*(query|mutation|subscription)\b\s*([_A-Za-z][_0-9A-Za-z]*)?/;

export function graphqlCall(ex: Exchange): GraphqlCall | undefined {
  let payload: Record<string, unknown> | undefined;
  if (ex.method === "POST") {
    const body = parseJson(ex.requestBody);
    if (body && typeof body === "object" && !Array.isArray(body)) payload = body as Record<string, unknown>;
  } else if (ex.method === "GET" && ex.url.searchParams.has("query")) {
    const vars = ex.url.searchParams.get("variables");
    payload = {
      query: ex.url.searchParams.get("query"),
      operationName: ex.url.searchParams.get("operationName") ?? undefined,
      variables: vars ? parseJson(vars) : undefined,
    };
  }
  if (!payload || typeof payload.query !== "string") return undefined;

  // `query` is also a plain search field (Algolia and others). Only a GraphQL document counts:
  // an operation keyword, or the shorthand selection-set form `{ field }`.
  const match = OPERATION_RE.exec(payload.query);
  if (!match && !/^\s*\{/.test(payload.query)) return undefined;
  const operationType = (match?.[1] ?? "query") as GraphqlCall["operationType"];
  const operationName =
    (typeof payload.operationName === "string" && payload.operationName) || match?.[2] || "anonymous";
  const variables =
    payload.variables && typeof payload.variables === "object"
      ? (payload.variables as Record<string, unknown>)
      : undefined;
  return { operationName, operationType, query: payload.query, variables };
}
