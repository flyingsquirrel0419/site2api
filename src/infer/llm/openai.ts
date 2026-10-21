// OpenAI-compatible provider: any /chat/completions endpoint (xAI Grok, OpenRouter, Ollama, vLLM, …).
// Plain fetch, no SDK, so it works against servers that only implement the common subset.
import { z } from "zod";
import { LlmError, type LlmMessage, type LlmProvider } from "./provider.js";

export interface OpenAiOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly label: string;
  /** Some servers reject json_schema; after the first such error, fall back to json_object. */
  private jsonSchemaSupported = true;

  constructor(private readonly options: OpenAiOptions) {
    this.label = `openai-compatible:${options.model}@${new URL(options.baseUrl).host}`;
  }

  async complete(system: string, messages: LlmMessage[], schema: z.ZodType): Promise<{ json: unknown; raw: string }> {
    const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" });
    const responseFormat = () =>
      this.jsonSchemaSupported
        ? { type: "json_schema", json_schema: { name: "annotations", strict: true, schema: jsonSchema } }
        : { type: "json_object" };
    const systemText = this.jsonSchemaSupported
      ? system
      : `${system}\n\nReply with only a JSON object matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`;

    let res = await this.post(systemText, messages, responseFormat());
    if (!res.ok && this.jsonSchemaSupported && res.status === 400) {
      this.jsonSchemaSupported = false;
      res = await this.post(
        `${system}\n\nReply with only a JSON object matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
        messages,
        responseFormat(),
      );
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      if (res.status === 401 || res.status === 403) throw new LlmError(`${this.label} rejected the API key (SITE2API_LLM_API_KEY).`);
      throw new LlmError(`${this.label} returned HTTP ${res.status}: ${detail}`);
    }

    const body = (await res.json()) as { choices?: { message?: { content?: string; refusal?: string } ; finish_reason?: string }[] };
    const choice = body.choices?.[0];
    if (choice?.message?.refusal) throw new LlmError(`${this.label} declined: ${choice.message.refusal}`);
    if (choice?.finish_reason === "length") throw new LlmError(`${this.label}'s answer was cut off (too many operations?).`);
    const raw = choice?.message?.content ?? "";
    try {
      return { json: JSON.parse(stripFences(raw)), raw };
    } catch {
      throw new LlmError(`${this.label} did not return JSON.`);
    }
  }

  private post(system: string, messages: LlmMessage[], responseFormat: unknown): Promise<Response> {
    return fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.options.apiKey && { authorization: `Bearer ${this.options.apiKey}` }),
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [{ role: "system", content: system }, ...messages],
        response_format: responseFormat,
      }),
    });
  }
}

function stripFences(text: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return m ? m[1]! : text;
}
