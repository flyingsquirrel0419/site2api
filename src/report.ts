import type { AuthHints } from "./normalize/auth.js";
import type { FilterResult } from "./normalize/filter.js";
import type { Dependencies } from "./normalize/links.js";
import type { Operation } from "./spec/operations.js";

export interface ReportInput {
  source: string;
  total: number;
  filter: FilterResult;
  hints: AuthHints;
  operations: Operation[];
  dependencies: Dependencies;
}

export function renderReport({ source, total, filter, hints, operations, dependencies }: ReportInput): string {
  const rest = operations.filter((op) => !op.graphql);
  const graphql = operations.filter((op) => op.graphql);
  const lines: string[] = [];

  lines.push(`# site2api report`, "");
  lines.push(`- Source: \`${source}\``);
  lines.push(`- Site: \`${filter.site || "(none)"}\``);
  lines.push(`- Requests: ${total} captured, ${filter.kept.length} kept`);
  lines.push(`- Operations: ${rest.length} REST, ${graphql.length} GraphQL`, "");

  const dropped = Object.entries(filter.dropped).filter(([, n]) => n > 0);
  if (dropped.length > 0) {
    lines.push("## Dropped requests", "", "| Reason | Count |", "|---|---|");
    for (const [reason, n] of dropped) lines.push(`| ${reason} | ${n} |`);
    lines.push("");
  }

  if (rest.length > 0) {
    lines.push("## REST operations", "", "| Method | Path | Samples | Auth |", "|---|---|---|---|");
    for (const op of rest) lines.push(`| ${op.method} | \`${op.template}\` | ${op.exchanges.length} | ${authLabel(op)} |`);
    lines.push("");
  }

  if (graphql.length > 0) {
    lines.push("## GraphQL operations", "", "| Operation | Type | Endpoint | Samples | Auth |", "|---|---|---|---|---|");
    for (const op of graphql) {
      lines.push(
        `| ${op.graphql!.operationName} | ${op.graphql!.operationType} | \`${op.template}\` | ${op.exchanges.length} | ${authLabel(op)} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Authentication shape", "");
  lines.push(`- Bearer token: ${hints.bearer ? "yes" : "no"}`);
  lines.push(`- Session cookies: ${list(hints.sessionCookies)}`);
  lines.push(`- CSRF headers: ${list(hints.csrfHeaders)}`);
  lines.push(`- API key headers: ${list(hints.apiKeyHeaders)}`);
  lines.push(`- API key query parameters: ${list(hints.apiKeyQueryParams)}`);
  const setters = operations.filter((op) => op.auth.setsCookies.length > 0);
  for (const op of setters) {
    lines.push(`- \`${op.method} ${op.template}\` sets cookies: ${list(op.auth.setsCookies)}`);
  }
  const { csrf, bearer } = dependencies.auth;
  if (csrf?.source) {
    lines.push(`- CSRF \`${csrf.header}\` comes from \`${label(csrf.source.op)}\` response \`${csrf.source.pointer}\``);
  }
  if (bearer?.source) lines.push(`- Bearer token comes from \`${label(bearer.source.op)}\` response \`${bearer.source.pointer}\``);
  lines.push("", "Values of cookies, tokens and passwords are never written to these files.", "");

  if (dependencies.links.length > 0) {
    lines.push("## Dependencies", "", "| Input | Comes from | Matched |", "|---|---|---|");
    for (const l of dependencies.links) {
      lines.push(
        `| \`${label(l.to)}\` ${l.target.in} \`${l.target.name}\` | \`${label(l.from)}\` → \`${l.pointer}\` | ${l.matches}/${l.samples} |`,
      );
    }
    lines.push("");
  }

  const warnings: string[] = [];
  const single = operations.filter((op) => op.exchanges.length === 1);
  if (single.length > 0) {
    warnings.push(
      `${single.length} operation(s) have a single sample; their schemas may mark optional fields as required.`,
    );
  }
  const writes = operations.filter((op) => op.method !== "GET" && !(op.graphql?.operationType === "query"));
  if (writes.length > 0) {
    warnings.push(`${writes.length} operation(s) may change data; they are marked \`writes: true\` in the spec.`);
  }
  if (operations.length === 0) warnings.push("No API traffic found. Was the HAR recorded with response bodies?");
  if (warnings.length > 0) {
    lines.push("## Warnings", "");
    for (const w of warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  return lines.join("\n");
}

function label(op: Operation): string {
  return op.graphql ? `graphql ${op.graphql.operationName}` : `${op.method} ${op.template}`;
}

function authLabel(op: Operation): string {
  const parts = [
    ...(op.auth.bearer ? ["bearer"] : []),
    ...op.auth.cookies.map((c) => `cookie:${c}`),
    ...op.auth.csrfHeaders.map((h) => `csrf:${h}`),
    ...op.auth.apiKeyHeaders.map((h) => `key:${h}`),
    ...op.auth.apiKeyQueryParams.map((q) => `key:?${q}`),
  ];
  return parts.length > 0 ? parts.join(", ") : "—";
}

function list(items: string[]): string {
  return items.length > 0 ? items.map((i) => `\`${i}\``).join(", ") : "none";
}
