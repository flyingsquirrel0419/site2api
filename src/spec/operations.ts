// Groups filtered exchanges into operations: one per (origin, method, path template),
// or one per GraphQL operation name.
import type { Exchange } from "../capture/har.js";
import { exchangeAuth, type AuthHints } from "../normalize/auth.js";
import { graphqlCall, type GraphqlCall } from "../normalize/graphql.js";
import { templatePaths, type PathParam } from "../normalize/template.js";

export interface OperationAuth {
  bearer: boolean;
  cookies: string[];
  csrfHeaders: string[];
  apiKeyHeaders: string[];
  setsCookies: string[];
}

export interface Operation {
  origin: string;
  method: string;
  template: string;
  params: PathParam[];
  exchanges: Exchange[];
  graphql?: { operationName: string; operationType: GraphqlCall["operationType"]; query: string };
  auth: OperationAuth;
}

const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function groupOperations(exchanges: Exchange[], hints: AuthHints): Operation[] {
  const pathsByOrigin = new Map<string, string[]>();
  for (const ex of exchanges) {
    if (graphqlCall(ex)) continue;
    pathsByOrigin.set(ex.url.origin, [...(pathsByOrigin.get(ex.url.origin) ?? []), ex.url.pathname]);
  }
  const templatesByOrigin = new Map([...pathsByOrigin].map(([origin, paths]) => [origin, templatePaths(paths)]));

  const ops = new Map<string, Operation>();
  for (const ex of exchanges) {
    const call = graphqlCall(ex);
    const tpl = call ? undefined : templatesByOrigin.get(ex.url.origin)?.get(ex.url.pathname);
    const template = tpl?.template ?? ex.url.pathname;
    const key = call
      ? `graphql ${ex.url.origin}${ex.url.pathname} ${call.operationName}`
      : `${ex.method} ${ex.url.origin}${template}`;

    let op = ops.get(key);
    if (!op) {
      op = {
        origin: ex.url.origin,
        method: ex.method,
        template,
        params: tpl?.params ?? [],
        exchanges: [],
        graphql: call && { operationName: call.operationName, operationType: call.operationType, query: call.query },
        auth: { bearer: true, cookies: [], csrfHeaders: [], apiKeyHeaders: [], setsCookies: [] },
      };
      ops.set(key, op);
    }
    op.exchanges.push(ex);
  }

  // An operation requires an auth element only if every sample carried it.
  for (const op of ops.values()) {
    const each = op.exchanges.map((ex) => exchangeAuth(ex, hints));
    const all = (pick: (a: (typeof each)[number]) => string[]) =>
      pick(each[0]!).filter((v) => each.every((a) => pick(a).includes(v)));
    op.auth = {
      bearer: each.every((a) => a.bearer),
      cookies: all((a) => a.cookies),
      csrfHeaders: all((a) => a.csrfHeaders),
      apiKeyHeaders: all((a) => a.apiKeyHeaders),
      setsCookies: [...new Set(each.flatMap((a) => a.setsCookies))].sort(),
    };
  }

  return [...ops.values()].sort(
    (a, b) =>
      a.origin.localeCompare(b.origin) ||
      a.template.localeCompare(b.template) ||
      METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method) ||
      (a.graphql?.operationName ?? "").localeCompare(b.graphql?.operationName ?? ""),
  );
}
