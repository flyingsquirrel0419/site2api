// context.md: a compact, value-free digest of the spec for the user's agent to read before
// writing annotations.json. Kept short on purpose — it has to fit comfortably in any agent's context.
import type { Schema } from "../normalize/schema.js";
import { defaultKind, type Catalog, type CatalogOperation } from "../spec/catalog.js";

const MAX_DEPTH = 3;
const MAX_PROPS = 12;

export function renderContext(catalog: Catalog): string {
  const lines: string[] = [];
  lines.push(`# site2api inference context: ${catalog.site}`, "");
  lines.push(
    "Recorded traffic was turned into the operations below. Write `annotations.json` next to `openapi.yaml`",
    "so each operation gets a clear tool name, a description an agent can act on, and the right kind.",
    "The format is in `infer/annotations.schema.json`. Rules:",
    "",
    "- `tool`: snake_case verb_noun, unique (e.g. `search_products`, `get_order`).",
    "- `description`: what it returns or does, when to use it, and where its inputs come from.",
    "- `params`: one short description per input name listed below. Use only those names.",
    "- `kind`: `read` (no side effects), `write` (changes data: orders, carts, messages, settings), or",
    "  `auth` (login/logout/session). `auth` operations are never exposed as tools.",
    "- `include: false` to drop noise (telemetry, feature flags, health checks).",
    "- Annotate only what you can judge; unannotated operations keep their defaults.",
    "",
  );

  lines.push("## Operations", "");
  for (const op of catalog.operations) lines.push(...renderOperation(op, catalog), "");

  const { session, csrf, bearer } = catalog.auth;
  if (session || csrf || bearer) {
    lines.push("## Authentication", "");
    if (session) lines.push(`- Session cookie(s) ${session.cookies.join(", ")} set by: ${session.setBy.join(", ") || "unknown"}`);
    if (csrf) {
      const src = csrf.source ? ` from ${csrf.source.operationId} response ${csrf.source.pointer}` : " (source unknown)";
      lines.push(`- CSRF header ${csrf.header}${src}; the generated server fetches it automatically.`);
    }
    if (bearer) {
      const src = bearer.source ? ` from ${bearer.source.operationId} response ${bearer.source.pointer}` : "";
      lines.push(`- Bearer token${src}.`);
    }
    lines.push("");
  }

  lines.push("## Example", "", "```json", JSON.stringify(example(catalog), null, 2), "```", "");
  return lines.join("\n");
}

function renderOperation(op: CatalogOperation, catalog: Catalog): string[] {
  const head = op.graphql
    ? `### ${op.id} — GraphQL ${op.graphql.operationType} ${op.graphql.operationName} (${op.method} ${op.path})`
    : `### ${op.id} — ${op.method} ${op.path}`;
  const lines = [head];
  lines.push(`- default kind: ${defaultKind(op)}; samples: ${op.samples}; auth: ${authText(op)}`);
  if (op.inputs.length > 0) {
    lines.push(`- inputs: ${op.inputs.map((i) => `${i.name}${i.required ? "" : "?"}: ${summarize(i.schema, 1)} (${i.in})`).join("; ")}`);
  }
  for (const [status, schema] of Object.entries(op.responses)) {
    lines.push(`- response ${status}: ${schema ? summarize(schema, 0) : "(no JSON body)"}`);
  }
  for (const l of catalog.links.filter((l) => l.to === op.id)) {
    lines.push(`- input ${l.target.name} comes from ${l.from} response ${l.pointer}`);
  }
  for (const l of catalog.links.filter((l) => l.from === op.id)) {
    lines.push(`- feeds ${l.to}.${l.target.name} via ${l.pointer}`);
  }
  return lines;
}

function authText(op: CatalogOperation): string {
  const parts = [...(op.auth.bearer ? ["bearer"] : []), ...op.auth.cookies.map((c) => `cookie ${c}`), ...op.auth.headers];
  return parts.length > 0 ? parts.join(", ") : "none";
}

/** One-line TypeScript-ish shape: { orders: { id: string(uuid), status: string }[] } */
export function summarize(schema: Schema, depth: number): string {
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const nullable = types.includes("null");
  const main = types.filter((t) => t !== "null");
  let text: string;
  if (main.includes("object") && schema.properties) {
    if (depth >= MAX_DEPTH) text = "{…}";
    else {
      const entries = Object.entries(schema.properties);
      const required = new Set(schema.required ?? []);
      const shown = entries
        .slice(0, MAX_PROPS)
        .map(([k, v]) => `${k}${required.has(k) ? "" : "?"}: ${summarize(v, depth + 1)}`);
      if (entries.length > MAX_PROPS) shown.push(`…${entries.length - MAX_PROPS} more`);
      text = `{ ${shown.join(", ")} }`;
    }
  } else if (main.includes("array")) {
    text = `${schema.items && Object.keys(schema.items).length > 0 ? summarize(schema.items, depth) : "unknown"}[]`;
  } else if (main.length > 0) {
    text = main.join(" | ") + (schema.format ? `(${schema.format})` : "");
  } else {
    text = "unknown";
  }
  return nullable ? `${text} | null` : text;
}

function example(catalog: Catalog): unknown {
  const op =
    catalog.operations.find((o) => o.inputs.length > 0 && defaultKind(o) === "read") ??
    catalog.operations.find((o) => o.inputs.length > 0) ??
    catalog.operations[0];
  return {
    version: 1,
    site: { name: "Example Site", description: "What this site is, in one sentence." },
    operations: op
      ? {
          [op.id]: {
            tool: op.id,
            title: "Short human title",
            description: "What it returns and when to use it.",
            ...(op.inputs.length > 0 && { params: { [op.inputs[0]!.name]: "What to pass here." } }),
            kind: defaultKind(op),
          },
        }
      : {},
  };
}
