// annotations.json: what the user's agent writes after reading context.md.
// It names and describes operations and decides which ones become tools. Every field is optional:
// without annotations, generate falls back to the heuristic operation ids.
import { z } from "zod";
import { canBeRead, defaultKind, type Catalog } from "../spec/catalog.js";

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

const OperationAnnotation = z
  .object({
    tool: z.string().regex(TOOL_NAME, "must be snake_case, start with a letter, max 64 chars").optional(),
    title: z.string().max(80).optional(),
    description: z.string().max(1024).optional(),
    params: z.record(z.string(), z.string().max(300)).optional(),
    kind: z.enum(["read", "write", "auth"]).optional(),
    include: z.boolean().optional(),
  })
  .strict();

export const AnnotationsSchema = z
  .object({
    version: z.literal(1),
    site: z.object({ name: z.string().max(80), description: z.string().max(1024).optional() }).strict().optional(),
    operations: z.record(z.string(), OperationAnnotation).default({}),
  })
  .strict();

export type Annotations = z.infer<typeof AnnotationsSchema>;
export type OperationAnnotation = z.infer<typeof OperationAnnotation>;

export function annotationsJsonSchema(): unknown {
  return z.toJSONSchema(AnnotationsSchema, { io: "input" });
}

export type ValidationResult = { ok: true; annotations: Annotations } | { ok: false; errors: string[] };

/** Validates shape and cross-checks against the catalog. Errors are written for an agent to fix. */
export function validateAnnotations(raw: unknown, catalog: Catalog): ValidationResult {
  const parsed = AnnotationsSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`),
    };
  }

  const errors: string[] = [];
  const byId = new Map(catalog.operations.map((op) => [op.id, op]));
  const tools = new Map<string, string>();

  for (const [id, ann] of Object.entries(parsed.data.operations)) {
    const op = byId.get(id);
    if (!op) {
      errors.push(`operations.${id}: unknown operationId. Known ids: ${[...byId.keys()].join(", ")}`);
      continue;
    }
    const tool = ann.tool ?? id;
    const other = tools.get(tool);
    if (other) errors.push(`operations.${id}.tool: "${tool}" is already used by operations.${other}`);
    else tools.set(tool, id);

    if (ann.kind && ann.kind !== "auth" && defaultKind(op) === "auth") {
      errors.push(`operations.${id}.kind: this is a login/session operation; it is never exposed as a tool`);
    } else if (ann.kind === "read" && !canBeRead(op)) {
      errors.push(`operations.${id}.kind: ${op.method} ${op.path} can change data, so it cannot be "read" (it would skip confirm and be called by verify)`);
    }

    const inputNames = new Set(op.inputs.map((i) => i.name));
    for (const param of Object.keys(ann.params ?? {})) {
      if (!inputNames.has(param)) {
        const known = [...inputNames].join(", ") || "(none)";
        errors.push(`operations.${id}.params.${param}: not an input of this operation. Inputs: ${known}`);
      }
    }
  }

  // Unannotated operations keep their ids as tool names; those must not collide either.
  for (const op of catalog.operations) {
    if (parsed.data.operations[op.id]) continue;
    const other = tools.get(op.id);
    if (other) errors.push(`operations.${other}.tool: "${op.id}" collides with the unannotated operation ${op.id}`);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, annotations: parsed.data };
}
