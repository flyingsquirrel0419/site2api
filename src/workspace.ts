// The output directory every command shares: file names and loaders.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { validateAnnotations, type Annotations } from "./infer/annotations.js";
import type { SecretFingerprint } from "./redact.js";
import { readCatalog, type Catalog } from "./spec/catalog.js";

export const SPEC_FILE = "openapi.yaml";
export const ANNOTATIONS_FILE = "annotations.json";
export const VERIFY_FILE = "verify.json";
export const SECRETS_FILE = join(".site2api", "secrets.json");
/** Where the original capture is: { har: absolute path }. */
export const SOURCE_FILE = join(".site2api", "source.json");
/** HAR written by `site2api record`. */
export const CAPTURE_FILE = join(".site2api", "capture.har");

export class AnnotationsError extends Error {
  constructor(readonly errors: string[]) {
    super(`annotations.json is invalid:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }
}

export async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function loadCatalog(dir: string): Promise<Catalog> {
  return readCatalog(parse(await readFile(join(dir, SPEC_FILE), "utf8")));
}

/** Validated annotations, or undefined when the file does not exist. Throws AnnotationsError. */
export async function loadAnnotations(dir: string, catalog: Catalog): Promise<Annotations | undefined> {
  const text = await readOptional(join(dir, ANNOTATIONS_FILE));
  if (text === undefined) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new AnnotationsError([`(root): not valid JSON (${err instanceof Error ? err.message : String(err)})`]);
  }
  const result = validateAnnotations(raw, catalog);
  if (!result.ok) throw new AnnotationsError(result.errors);
  return result.annotations;
}

export async function loadFingerprint(dir: string): Promise<SecretFingerprint | undefined> {
  const text = await readOptional(join(dir, SECRETS_FILE));
  return text === undefined ? undefined : (JSON.parse(text) as SecretFingerprint);
}

/** The capture this directory was built from: the recorded HAR, or the path from-har remembered. */
export async function findCapture(dir: string): Promise<string | undefined> {
  if ((await readOptional(join(dir, CAPTURE_FILE))) !== undefined) return join(dir, CAPTURE_FILE);
  const source = await readOptional(join(dir, SOURCE_FILE));
  return source ? (JSON.parse(source) as { har?: string }).har : undefined;
}
