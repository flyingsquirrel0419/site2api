// `site2api infer`: the Infer stage without an agent. Sends the value-free context to an LLM,
// validates the answer exactly like `generate` would, and feeds errors back for a retry.
import { validateAnnotations, type Annotations } from "../annotations.js";
import { renderContext } from "../context.js";
import type { Catalog } from "../../spec/catalog.js";
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./anthropic.js";
import { OpenAiCompatibleProvider } from "./openai.js";
import { LlmError, type LlmMessage, type LlmProvider } from "./provider.js";
import { llmAnnotationsSchema, toAnnotations, type LlmAnnotations } from "./schema.js";

export const MAX_ATTEMPTS = 3;

const SYSTEM = `You annotate an API that was reverse-engineered from a user's own browser traffic, so that an
AI agent can use it through MCP tools. Follow the rules in the context exactly. Be conservative:
anything that creates, changes, deletes, sends, buys or posts is "write"; login, logout, session and
token endpoints are "auth". Annotate every operation listed.`;

export interface InferResult {
  annotations: Annotations;
  attempts: number;
}

export async function inferAnnotations(catalog: Catalog, provider: LlmProvider, context = renderContext(catalog)): Promise<InferResult> {
  const schema = llmAnnotationsSchema(catalog);
  const messages: LlmMessage[] = [{ role: "user", content: context }];

  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { json, raw } = await provider.complete(SYSTEM, messages, schema);
    const parsed = schema.safeParse(json);
    const errors = parsed.success
      ? (() => {
          const result = validateAnnotations(toAnnotations(parsed.data as LlmAnnotations), catalog);
          return result.ok ? [] : result.errors;
        })()
      : parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);

    if (errors.length === 0) {
      return { annotations: toAnnotations(parsed.data as LlmAnnotations), attempts: attempt };
    }
    lastErrors = errors;
    messages.push(
      { role: "assistant", content: raw || JSON.stringify(json) },
      { role: "user", content: `That did not validate. Fix exactly these problems and answer again in full:\n${errors.map((e) => `- ${e}`).join("\n")}` },
    );
  }
  throw new LlmError(`No valid annotations after ${MAX_ATTEMPTS} attempts:\n${lastErrors.map((e) => `  - ${e}`).join("\n")}`);
}

export type ProviderName = "anthropic" | "openai";

/** Picks a provider from the flag, or from whichever credentials are present in env. */
export function providerFromEnv(name: ProviderName | undefined, model: string | undefined, env = process.env): LlmProvider {
  const chosen = name ?? (env.SITE2API_LLM_BASE_URL ? "openai" : env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN ? "anthropic" : undefined);
  if (chosen === "openai") {
    const baseUrl = env.SITE2API_LLM_BASE_URL;
    const resolvedModel = model ?? env.SITE2API_LLM_MODEL;
    if (!baseUrl || !resolvedModel) {
      throw new LlmError("OpenAI-compatible mode needs SITE2API_LLM_BASE_URL and SITE2API_LLM_MODEL (or --model).");
    }
    return new OpenAiCompatibleProvider({ baseUrl, apiKey: env.SITE2API_LLM_API_KEY, model: resolvedModel });
  }
  if (chosen === "anthropic") return new AnthropicProvider(model ?? DEFAULT_ANTHROPIC_MODEL);
  throw new LlmError(
    "No LLM configured. Set ANTHROPIC_API_KEY for Claude, or SITE2API_LLM_BASE_URL + SITE2API_LLM_MODEL (+ SITE2API_LLM_API_KEY) for an OpenAI-compatible API — or let your coding agent annotate with the site2api skill.",
  );
}
