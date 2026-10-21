// Catalog + annotations → tools.json.
import type { Annotations } from "../infer/annotations.js";
import { effectiveKind, type Catalog, type CatalogOperation } from "../spec/catalog.js";
import { apiKeyEnv, type HttpCall, type ToolDef, type ToolsFile } from "./types.js";

export interface BuildToolsOptions {
  /** Include tools that change data. They still require `confirm: true` on every call. */
  allowWrites?: boolean;
  /** Results of `site2api verify`, by operationId. */
  verified?: Map<string, NonNullable<ToolDef["verified"]>>;
  /** Server and site name; overrides annotations and the recorded host. */
  name?: string;
  /** Drop read tools that did not pass verify ("warn" counts as passing). Writes are never called by verify, so they are kept. */
  onlyVerified?: boolean;
}

export function buildTools(catalog: Catalog, annotations: Annotations, options: BuildToolsOptions = {}): ToolsFile {
  const anns = annotations.operations;
  const toolName = new Map(catalog.operations.map((op) => [op.id, anns[op.id]?.tool ?? op.id]));
  const siteName = options.name ?? annotations.site?.name ?? catalog.site;

  const tools: ToolDef[] = [];
  const skipped: ToolsFile["skipped"] = [];
  for (const op of catalog.operations) {
    const ann = anns[op.id] ?? {};
    const kind = effectiveKind(op, ann.kind);
    if (ann.include === false) skipped.push({ operationId: op.id, reason: "excluded by annotations" });
    else if (kind === "auth") skipped.push({ operationId: op.id, reason: "login/session operation (never exposed)" });
    else if (kind === "write" && !options.allowWrites) {
      skipped.push({ operationId: op.id, reason: "changes data (re-run generate with --allow-writes)" });
    } else if (kind === "read" && options.onlyVerified && !["pass", "warn"].includes(options.verified?.get(op.id) ?? "")) {
      skipped.push({ operationId: op.id, reason: `did not pass verify (${options.verified?.get(op.id) ?? "not verified"})` });
    } else {
      const verified = options.verified?.get(op.id);
      tools.push({
        name: toolName.get(op.id)!,
        ...(ann.title && { title: ann.title }),
        description: describe(op, ann.description, catalog, toolName),
        operationId: op.id,
        kind,
        inputSchema: inputSchema(op, ann.params ?? {}, kind, siteName),
        http: httpCall(op),
        auth: {
          cookie: op.auth.cookies.length > 0,
          bearer: op.auth.bearer,
          csrf: !!catalog.auth.csrf && op.auth.headers.includes(catalog.auth.csrf.header),
          apiKeys: op.auth.apiKeys.map((k) => ({ ...k, env: apiKeyEnv(k.name) })),
        },
        ...(verified && { verified }),
      });
    }
  }

  const file: ToolsFile = {
    version: 1,
    site: { name: siteName, ...(annotations.site?.description && { description: annotations.site.description }) },
    baseUrl: catalog.baseUrl,
    tools,
    skipped,
  };

  const csrf = catalog.auth.csrf;
  if (csrf && tools.some((t) => t.auth.csrf)) {
    const sourceOp = csrf.source && catalog.operations.find((op) => op.id === csrf.source!.operationId);
    // Only a source we can call without arguments can be fetched automatically.
    file.csrf = {
      header: csrf.header,
      ...(sourceOp && sourceOp.inputs.every((i) => !i.required) && { source: { http: httpCall(sourceOp), pointer: csrf.source!.pointer } }),
    };
  }
  return file;
}

function httpCall(op: CatalogOperation): HttpCall {
  return {
    method: op.method,
    url: op.url,
    inputs: op.inputs.map((i) => ({
      name: i.name,
      in: i.in,
      source: i.source,
      ...(i.schema.default !== undefined && { default: i.schema.default }),
    })),
    ...(op.bodyType && { bodyType: op.bodyType }),
    ...(op.graphql && { graphql: { operationName: op.graphql.operationName, query: op.graphql.query } }),
  };
}

function inputSchema(
  op: CatalogOperation,
  params: Record<string, string>,
  kind: "read" | "write",
  siteName: string,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const input of op.inputs) {
    const description = params[input.name];
    properties[input.name] = { ...input.schema, ...(description && { description }) };
    if (input.required) required.push(input.name);
  }
  if (kind === "write") {
    properties.confirm = {
      type: "boolean",
      description: `Must be true. This changes data on ${siteName}; only set it after the user agreed to this exact action.`,
    };
    required.push("confirm");
  }
  return { type: "object", properties, ...(required.length > 0 && { required }), additionalProperties: false };
}

function describe(op: CatalogOperation, written: string | undefined, catalog: Catalog, toolName: Map<string, string>): string {
  const lines = [written ?? `${op.summary ?? op.id}. (Auto-generated name; recorded from ${op.method} ${op.path}.)`];
  // Tell the calling agent how to chain tools: where each input's value comes from.
  for (const link of catalog.links.filter((l) => l.to === op.id)) {
    const input = op.inputs.find((i) => i.in === link.target.in && (i.source === link.target.name || `/${i.source}` === link.target.name));
    if (!input) continue;
    lines.push(`Input \`${input.name}\`: use a value from \`${toolName.get(link.from)}\` results at ${link.pointer}.`);
  }
  return lines.join("\n");
}
