import type { z } from "zod";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmProvider {
  /** e.g. "anthropic:claude-opus-5-5", for logs. */
  readonly label: string;
  /** Returns the model's JSON output for the given schema, plus its raw text for follow-up turns. */
  complete(system: string, messages: LlmMessage[], schema: z.ZodType): Promise<{ json: unknown; raw: string }>;
}

export class LlmError extends Error {}
