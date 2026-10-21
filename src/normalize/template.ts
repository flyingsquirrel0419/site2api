// Turns concrete paths into templates: /api/orders/3f6c…  →  /api/orders/{orderId}
//
// A segment becomes a parameter when either
//   1. its shape is clearly an identifier (number, UUID, long hex, opaque token, date), or
//   2. three or more sibling paths differ only at that position AND the parent collection
//      was itself requested (/products plus /products/keyboard, /products/hub, …).
// Rule 2's parent check is what keeps /api/products and /api/orders apart.

export type SegmentKind = "integer" | "uuid" | "hex" | "token" | "date" | "slug";

export interface PathParam {
  name: string;
  kind: SegmentKind;
  values: string[];
}

export interface PathTemplate {
  template: string;
  params: PathParam[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{16,}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,}$/;
const SIBLING_THRESHOLD = 3;

export function segmentKind(segment: string): SegmentKind | undefined {
  if (/^\d+$/.test(segment)) return "integer";
  if (UUID.test(segment)) return "uuid";
  if (DATE.test(segment)) return "date";
  if (HEX.test(segment)) return "hex";
  // Opaque tokens mix letters and digits; long plain words (e.g. "notification-settings") are not tokens.
  if (TOKEN.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment)) return "token";
  return undefined;
}

function split(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export function singular(word: string): string {
  if (/ies$/i.test(word)) return word.slice(0, -3) + "y";
  if (/(?:ss|us|is)$/i.test(word)) return word;
  if (/(?:sh|ch|x|z)es$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word)) return word.slice(0, -1);
  return word;
}

function camel(word: string): string {
  return word.replace(/[-_.]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, "");
}

/** Maps every concrete path to its template. Paths are compared per host by the caller. */
export function templatePaths(paths: Iterable<string>): Map<string, PathTemplate> {
  const unique = [...new Set(paths)];
  const segmentsOf = new Map(unique.map((p) => [p, split(p)]));
  const known = new Set(unique.map((p) => "/" + split(p).join("/")));

  // Pass 1: shape-based parameters.
  const isParam = new Map<string, boolean[]>();
  for (const [path, segs] of segmentsOf) isParam.set(path, segs.map((s) => segmentKind(s) !== undefined));

  // Pass 2: sibling variance. Group by everything except position i (with pass-1 params masked).
  const maxLen = Math.max(0, ...[...segmentsOf.values()].map((s) => s.length));
  for (let i = 0; i < maxLen; i++) {
    const groups = new Map<string, string[]>();
    for (const [path, segs] of segmentsOf) {
      if (segs.length <= i || isParam.get(path)![i]) continue;
      const mask = segs.map((s, j) => (j === i ? "*" : isParam.get(path)![j] ? "{}" : s)).join("/");
      groups.set(mask, [...(groups.get(mask) ?? []), path]);
    }
    for (const members of groups.values()) {
      const values = new Set(members.map((p) => segmentsOf.get(p)![i]!));
      const parent = "/" + segmentsOf.get(members[0]!)!.slice(0, i).join("/");
      if (values.size >= SIBLING_THRESHOLD && i > 0 && known.has(parent)) {
        for (const p of members) isParam.get(p)![i] = true;
      }
    }
  }

  // Build templates and collect parameter values per template.
  const result = new Map<string, PathTemplate>();
  const byTemplate = new Map<string, PathTemplate>();
  for (const [path, segs] of segmentsOf) {
    const flags = isParam.get(path)!;
    const names: string[] = [];
    const parts = segs.map((seg, i) => {
      if (!flags[i]) return seg;
      const prev = i > 0 && !flags[i - 1] ? segs[i - 1]! : undefined;
      const kind = segmentKind(seg) ?? "slug";
      let name = prev ? camel(singular(prev)) + (kind === "date" ? "Date" : kind === "slug" ? "Slug" : "Id") : "param";
      if (names.includes(name)) name += names.length + 1;
      names.push(name);
      return `{${name}}`;
    });
    const template = "/" + parts.join("/");
    let entry = byTemplate.get(template);
    if (!entry) {
      entry = { template, params: names.map((name) => ({ name, kind: "slug" as SegmentKind, values: [] })) };
      byTemplate.set(template, entry);
    }
    let k = 0;
    segs.forEach((seg, i) => {
      if (!flags[i]) return;
      const param = entry.params[k++]!;
      if (!param.values.includes(seg)) param.values.push(seg);
    });
    result.set(path, entry);
  }

  for (const entry of byTemplate.values()) {
    for (const param of entry.params) param.kind = commonKind(param.values);
  }
  return result;
}

function commonKind(values: string[]): SegmentKind {
  const kinds = new Set(values.map((v) => segmentKind(v) ?? "slug"));
  return kinds.size === 1 ? [...kinds][0]! : "slug";
}
