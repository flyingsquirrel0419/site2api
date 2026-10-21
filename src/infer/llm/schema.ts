// The shape the LLM fills in. annotations.json keys operations by id (a record), which strict
// structured-output modes do not support, so the model returns a list with every field present
// and operationId constrained to the known ids. toAnnotations() converts it back.
import { z } from "zod";
import type { Annotations } from "../annotations.js";
import type { Catalog } from "../../spec/catalog.js";

export function llmAnnotationsSchema(catalog: Catalog) {
  const ids = catalog.operations.map((op) => op.id);
  if (ids.length === 0) throw new Error("The spec has no operations to annotate.");
  return z.object({
    site: z.object({
      name: z.string().describe("Human name of the site, e.g. 'Demo Shop'"),
      description: z.string().describe("One sentence on what the site is"),
    }),
    operations: z.array(
      z.object({
        operationId: z.enum(ids as [string, ...string[]]),
        tool: z.string().describe("snake_case verb_noun tool name, unique"),
        title: z.string().describe("Short human title"),
        description: z.string().describe("What it returns or does, when to use it, where its inputs come from"),
        params: z.array(z.object({ name: z.string(), description: z.string() })),
        kind: z.enum(["read", "write", "auth"]),
        include: z.boolean().describe("false for telemetry, feature flags, health checks and other noise"),
      }),
    ),
  });
}

export type LlmAnnotations = z.infer<ReturnType<typeof llmAnnotationsSchema>>;

export function toAnnotations(output: LlmAnnotations): Annotations {
  const operations: Annotations["operations"] = {};
  for (const op of output.operations) {
    operations[op.operationId] = {
      tool: op.tool,
      title: op.title,
      description: op.description,
      ...(op.params.length > 0 && { params: Object.fromEntries(op.params.map((p) => [p.name, p.description])) }),
      kind: op.kind,
      include: op.include,
    };
  }
  return { version: 1, site: output.site, operations };
}
