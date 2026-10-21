// Value-flow analysis: finds where the inputs of one request came from, without an LLM.
// For every value a request sends (path/query parameter, JSON body field, GraphQL variable,
// CSRF/API-key header, bearer token), look for the same value in an *earlier* response body.
// Only locations (JSON pointers) are kept — never the values themselves.
import { header, parseJson, type Exchange } from "../capture/har.js";
import type { Operation } from "../spec/operations.js";
import { graphqlCall } from "./graphql.js";
import { segmentKind } from "./template.js";

export type TargetIn = "path" | "query" | "body" | "variables" | "header" | "bearer";

export interface Target {
  in: TargetIn;
  /** Parameter or header name, or a JSON pointer for body/variables. Empty for bearer. */
  name: string;
}

export interface Link {
  from: Operation;
  status: number;
  /** Generalized pointer into the producer's response: array indices are `*`. */
  pointer: string;
  to: Operation;
  target: Target;
  /** Consumer samples whose value was found at this pointer. */
  matches: number;
  /** Consumer samples that sent a value at this target at all. */
  samples: number;
}

export interface AuthFlow {
  session?: { cookies: string[]; setBy: Operation[] };
  csrf?: { header: string; source?: { op: Operation; status: number; pointer: string } };
  bearer?: { source?: { op: Operation; status: number; pointer: string } };
}

export interface Dependencies {
  links: Link[];
  auth: AuthFlow;
}

// Values this short or this common match by coincidence far too often.
const MIN_LENGTH = 3;
const COMMON = new Set(["true", "false", "null", "undefined", "none", "asc", "desc", "json"]);

interface Producer {
  op: Operation;
  status: number;
  pointer: string;
}

export function findDependencies(exchanges: Exchange[], ops: Operation[], sessionCookies: string[]): Dependencies {
  const opOf = new Map<Exchange, Operation>();
  for (const op of ops) for (const ex of op.exchanges) opOf.set(ex, op);

  // (consumer op, target) → producer key → count; plus how many samples sent the target.
  const tallies = new Map<
    string,
    { to: Operation; target: Target; samples: number; hits: Map<string, Producer & { n: number; opaque: boolean }> }
  >();
  const seen = new Map<string, Producer[]>(); // value → where it appeared in earlier responses

  for (const ex of exchanges) {
    const op = opOf.get(ex);
    if (!op) continue;

    const inputs = inputsOf(ex, op);
    for (const use of inputs) {
      const key = `${ops.indexOf(op)}|${use.target.in}|${use.target.name}`;
      let tally = tallies.get(key);
      if (!tally) tallies.set(key, (tally = { to: op, target: use.target, samples: 0, hits: new Map() }));
      tally.samples++;
      // Count each producer location once per consumer sample.
      const counted = new Set<string>();
      for (const p of seen.get(use.value) ?? []) {
        const pk = `${ops.indexOf(p.op)}|${p.status}|${p.pointer}`;
        if (counted.has(pk)) continue;
        counted.add(pk);
        const hit = tally.hits.get(pk) ?? { ...p, n: 0, opaque: false };
        hit.n++;
        hit.opaque ||= isOpaque(use.value);
        tally.hits.set(pk, hit);
      }
    }

    const body = parseJson(ex.responseBody);
    if (body === undefined) continue;
    // A value this request sent and the response merely echoes (a search term in highlight
    // results, a filter repeated back) was not produced by this response.
    const sent = new Set(inputs.map((i) => i.value));
    for (const [pointer, value] of leaves(body)) {
      if (sent.has(value)) continue;
      const list = seen.get(value) ?? [];
      list.push({ op, status: ex.status, pointer });
      seen.set(value, list);
    }
  }

  const links: Link[] = [];
  for (const tally of tallies.values()) {
    const best = [...tally.hits.values()].sort(
      (a, b) => b.n - a.n || writeRank(a.op) - writeRank(b.op) || ops.indexOf(a.op) - ops.indexOf(b.op),
    )[0];
    // One match on a plain word ("usb" in a search box and in a tag list) is coincidence.
    if (!best || (best.n < 2 && !best.opaque)) continue;
    links.push({
      from: best.op,
      status: best.status,
      pointer: best.pointer,
      to: tally.to,
      target: tally.target,
      matches: best.n,
      samples: tally.samples,
    });
  }
  links.sort((a, b) => ops.indexOf(a.to) - ops.indexOf(b.to) || a.target.name.localeCompare(b.target.name));

  return { links: links.filter((l) => l.target.in !== "header" && l.target.in !== "bearer"), auth: authFlow(ops, links, sessionCookies) };
}

function authFlow(ops: Operation[], links: Link[], sessionCookies: string[]): AuthFlow {
  const flow: AuthFlow = {};
  const setBy = ops.filter((op) => op.auth.setsCookies.some((c) => sessionCookies.includes(c)));
  if (sessionCookies.length > 0) flow.session = { cookies: sessionCookies, setBy };

  const csrfHeader = ops.flatMap((op) => op.auth.csrfHeaders)[0];
  if (csrfHeader) {
    const link = links.find((l) => l.target.in === "header" && l.target.name === csrfHeader);
    flow.csrf = { header: csrfHeader, ...(link && { source: { op: link.from, status: link.status, pointer: link.pointer } }) };
  }
  if (ops.some((op) => op.auth.bearer)) {
    const link = links.find((l) => l.target.in === "bearer");
    flow.bearer = link ? { source: { op: link.from, status: link.status, pointer: link.pointer } } : {};
  }
  return flow;
}

function writeRank(op: Operation): number {
  if (op.graphql) return op.graphql.operationType === "query" ? 0 : 1;
  return op.method === "GET" ? 0 : 1;
}

interface Input {
  target: Target;
  value: string;
}

function inputsOf(ex: Exchange, op: Operation): Input[] {
  const inputs: Input[] = [];
  const add = (target: Target, raw: unknown) => {
    const value = scalar(raw);
    if (value !== undefined) inputs.push({ target, value });
  };

  if (op.graphql) {
    for (const [pointer, value] of leaves(graphqlCall(ex)?.variables ?? {})) add({ in: "variables", name: pointer }, value);
  } else {
    const tplSegs = op.template.split("/").filter(Boolean);
    const segs = ex.url.pathname.split("/").filter(Boolean);
    tplSegs.forEach((t, i) => {
      if (t.startsWith("{") && segs[i] !== undefined) add({ in: "path", name: t.slice(1, -1) }, decodeURIComponent(segs[i]!));
    });
    for (const [name, value] of ex.url.searchParams) add({ in: "query", name }, value);
    const body = parseJson(ex.requestBody);
    if (body !== undefined) for (const [pointer, value] of leaves(body)) add({ in: "body", name: pointer }, value);
  }

  for (const name of [...op.auth.csrfHeaders, ...op.auth.apiKeyHeaders]) add({ in: "header", name }, header(ex.requestHeaders, name));
  if (op.auth.bearer) add({ in: "bearer", name: "" }, header(ex.requestHeaders, "authorization")?.replace(/^bearer\s+/i, ""));
  return inputs;
}

/** Identifier-shaped values are unlikely to match by chance even once. */
function isOpaque(value: string): boolean {
  const kind = segmentKind(value);
  if (kind === "uuid" || kind === "hex" || kind === "token") return true;
  if (kind === "integer") return value.length >= 6;
  return value.length >= 12 && /\d/.test(value) && /[A-Za-z]/.test(value);
}

function scalar(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value);
  return text.length >= MIN_LENGTH && !COMMON.has(text.toLowerCase()) ? text : undefined;
}

/** Yields [generalized pointer, scalar value] for every leaf; array indices become `*`. */
function* leaves(value: unknown, pointer = ""): Generator<[string, string]> {
  if (Array.isArray(value)) {
    for (const item of value) yield* leaves(item, `${pointer}/*`);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) yield* leaves(v, `${pointer}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`);
  } else {
    const text = scalar(value);
    if (text !== undefined) yield [pointer, text];
  }
}

/** `/orders/*\/id` → `/orders/0/id`, for OpenAPI runtime expressions that need a concrete pointer. */
export function concretePointer(pointer: string): string {
  return pointer.replace(/\/\*(?=\/|$)/g, "/0");
}
