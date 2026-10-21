// Claude API provider: structured output via output_config.format, with server-side refusal
// fallback so a policy decline is retried on another model inside the same call.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { LlmError, type LlmMessage, type LlmProvider } from "./provider.js";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export class AnthropicProvider implements LlmProvider {
  readonly label: string;
  private readonly client: Anthropic;

  constructor(private readonly model = DEFAULT_ANTHROPIC_MODEL) {
    this.label = `anthropic:${model}`;
    // Resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.
    this.client = new Anthropic();
  }

  async complete(system: string, messages: LlmMessage[], schema: z.ZodType): Promise<{ json: unknown; raw: string }> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        system,
        messages,
        output_config: { format: betaZodOutputFormat(schema) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new LlmError("Claude API rejected the credentials (check ANTHROPIC_API_KEY).");
      if (err instanceof Anthropic.RateLimitError) throw new LlmError("Claude API rate limit reached; try again shortly.");
      if (err instanceof Anthropic.APIError) throw new LlmError(`Claude API error ${err.status}: ${err.message}`);
      throw err;
    }

    if (response.stop_reason === "refusal") throw new LlmError("Claude declined to annotate this capture.");
    if (response.stop_reason === "max_tokens") throw new LlmError("Claude's answer was cut off (too many operations?).");
    const raw = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    if (response.parsed_output == null) throw new LlmError("Claude returned output that does not match the schema.");
    return { json: response.parsed_output, raw };
  }
}
