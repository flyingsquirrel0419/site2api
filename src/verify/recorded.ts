// The capture `verify` replays inputs from. A missing or broken file is a failure: continuing
// would call the live site without those inputs and still write a report.
import { readFile } from "node:fs/promises";
import { analyzeHar } from "../pipeline.js";
import type { Operation } from "../spec/operations.js";

export async function loadRecordedOperations(harPath: string): Promise<Operation[]> {
  let text: string;
  try {
    text = await readFile(harPath, "utf8");
  } catch (err) {
    throw unreadable(harPath, err);
  }
  try {
    return analyzeHar(text).operations;
  } catch (err) {
    throw unreadable(harPath, err);
  }
}

function unreadable(harPath: string, err: unknown): Error {
  const reason = err instanceof Error ? err.message : String(err);
  return new Error(
    `Could not read ${harPath} (${reason}). Verify stopped so it would not call the site without the recorded inputs.`,
  );
}
