// JSON Schema inference from samples, and merging of the schemas inferred from many samples.
// Internally `type` is always a sorted list; finalize() collapses it for output.

export interface Schema {
  type?: string | string[];
  format?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  additionalProperties?: boolean;
  /** Set on inputs that had the same (non-sensitive) value in every sample. */
  default?: unknown;
}

interface Inner {
  types: string[];
  format?: string;
  properties?: Record<string, Inner>;
  required?: string[];
  items?: Inner;
}

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URI = /^https?:\/\/\S+$/;

function infer(value: unknown): Inner {
  if (value === null) return { types: ["null"] };
  if (Array.isArray(value)) {
    const items = value.map(infer).reduce<Inner | undefined>((acc, s) => (acc ? merge(acc, s) : s), undefined);
    return items ? { types: ["array"], items } : { types: ["array"] };
  }
  switch (typeof value) {
    case "boolean":
      return { types: ["boolean"] };
    case "number":
      return { types: [Number.isInteger(value) ? "integer" : "number"] };
    case "string":
      return { types: ["string"], format: stringFormat(value) };
    case "object": {
      // No prototype: a response key named "__proto__" must stay an ordinary property.
      const properties: Record<string, Inner> = Object.create(null);
      for (const [k, v] of Object.entries(value as object)) properties[k] = infer(v);
      return { types: ["object"], properties, required: Object.keys(properties).sort() };
    }
    default:
      return { types: [] };
  }
}

function stringFormat(value: string): string | undefined {
  if (DATE_TIME.test(value)) return "date-time";
  if (DATE.test(value)) return "date";
  if (UUID.test(value)) return "uuid";
  if (EMAIL.test(value)) return "email";
  if (URI.test(value)) return "uri";
  return undefined;
}

function merge(a: Inner, b: Inner): Inner {
  let types = [...new Set([...a.types, ...b.types])];
  if (types.includes("number") && types.includes("integer")) types = types.filter((t) => t !== "integer");
  const out: Inner = { types: types.sort() };

  const aHasString = a.types.includes("string");
  const bHasString = b.types.includes("string");
  if (aHasString && bHasString) {
    if (a.format === b.format && a.format) out.format = a.format;
  } else if (aHasString || bHasString) {
    const format = aHasString ? a.format : b.format;
    if (format) out.format = format;
  }

  if (a.properties || b.properties) {
    const properties: Record<string, Inner> = Object.create(null);
    for (const key of new Set([...Object.keys(a.properties ?? {}), ...Object.keys(b.properties ?? {})])) {
      const pa = a.properties?.[key];
      const pb = b.properties?.[key];
      properties[key] = pa && pb ? merge(pa, pb) : (pa ?? pb)!;
    }
    out.properties = properties;
    // A key is required only if every object sample had it. A side that was never an object
    // (e.g. null) does not count against it.
    const ra = a.properties ? new Set(a.required) : undefined;
    const rb = b.properties ? new Set(b.required) : undefined;
    out.required = Object.keys(properties)
      .filter((k) => (!ra || ra.has(k)) && (!rb || rb.has(k)))
      .sort();
  }

  if (a.items && b.items) out.items = merge(a.items, b.items);
  else if (a.items || b.items) out.items = a.items ?? b.items;
  return out;
}

function finalize(s: Inner): Schema {
  const out: Schema = {};
  if (s.types.length === 1) out.type = s.types[0];
  else if (s.types.length > 1) out.type = s.types;
  if (s.format) out.format = s.format;
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, finalize(v)]));
    if (s.required && s.required.length > 0) out.required = s.required;
  }
  if (s.types.includes("array")) out.items = s.items ? finalize(s.items) : {};
  return out;
}

/** Infers one schema that accepts every sample. */
export function inferSchema(samples: unknown[]): Schema {
  const merged = samples.map(infer).reduce<Inner | undefined>((acc, s) => (acc ? merge(acc, s) : s), undefined);
  return merged ? finalize(merged) : {};
}

/** Schema for string-valued inputs such as query or path parameters. */
export function inferScalarSchema(values: string[]): Schema {
  if (values.length > 0 && values.every((v) => /^-?\d+$/.test(v))) return { type: "integer" };
  if (values.length > 0 && values.every((v) => /^-?\d+(?:\.\d+)?$/.test(v))) return { type: "number" };
  if (values.length > 0 && values.every((v) => v === "true" || v === "false")) return { type: "boolean" };
  const format = values.length > 0 ? stringFormat(values[0]!) : undefined;
  return format && values.every((v) => stringFormat(v) === format) ? { type: "string", format } : { type: "string" };
}
