import express from "express";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { AnthropicProvider } from "../src/infer/llm/anthropic.js";
import { inferAnnotations, MAX_ATTEMPTS, providerFromEnv } from "../src/infer/llm/infer.js";
import { OpenAiCompatibleProvider } from "../src/infer/llm/openai.js";
import { LlmError, type LlmMessage, type LlmProvider } from "../src/infer/llm/provider.js";
import { analyzeHar } from "../src/pipeline.js";
import { readCatalog } from "../src/spec/catalog.js";

const catalog = readCatalog(analyzeHar(readFileSync(new URL("./fixtures/demo-shop.har", import.meta.url), "utf8")).spec);

const good = {
  site: { name: "Demo Shop", description: "A small online store." },
  operations: [
    { operationId: "list_products", tool: "search_products", title: "Search products", description: "Search the catalog.", params: [{ name: "q", description: "Search text" }], kind: "read", include: true },
    { operationId: "post_login", tool: "log_in", title: "Log in", description: "Starts a session.", params: [], kind: "auth", include: true },
  ],
};

/** Replays scripted answers and records what it was sent. */
class ScriptedProvider implements LlmProvider {
  readonly label = "scripted";
  calls: LlmMessage[][] = [];
  constructor(private readonly answers: unknown[]) {}
  async complete(_system: string, messages: LlmMessage[], _schema: z.ZodType) {
    this.calls.push([...messages]);
    const json = this.answers[Math.min(this.calls.length - 1, this.answers.length - 1)];
    return { json, raw: JSON.stringify(json) };
  }
}

describe("inferAnnotations", () => {
  it("converts the model's list into annotations.json", async () => {
    const { annotations, attempts } = await inferAnnotations(catalog, new ScriptedProvider([good]));
    expect(attempts).toBe(1);
    expect(annotations).toEqual({
      version: 1,
      site: { name: "Demo Shop", description: "A small online store." },
      operations: {
        list_products: { tool: "search_products", title: "Search products", description: "Search the catalog.", params: { q: "Search text" }, kind: "read", include: true },
        post_login: { tool: "log_in", title: "Log in", description: "Starts a session.", kind: "auth", include: true },
      },
    });
  });

  it("sends validation errors back and accepts the corrected answer", async () => {
    const bad = { ...good, operations: [{ ...good.operations[0], params: [{ name: "query", description: "x" }] }] };
    const provider = new ScriptedProvider([bad, good]);
    const { attempts } = await inferAnnotations(catalog, provider);
    expect(attempts).toBe(2);
    const followUp = provider.calls[1]!.at(-1)!.content;
    expect(followUp).toContain("operations.list_products.params.query: not an input of this operation. Inputs: page, q");
  });

  it("gives up after the last attempt with the remaining errors", async () => {
    const bad = { ...good, operations: [{ ...good.operations[0], tool: "Search Products" }] };
    const provider = new ScriptedProvider([bad]);
    await expect(inferAnnotations(catalog, provider)).rejects.toThrow(/No valid annotations after 3 attempts[\s\S]*snake_case/);
    expect(provider.calls).toHaveLength(MAX_ATTEMPTS);
  });

  it("sends only the value-free context", async () => {
    const provider = new ScriptedProvider([good]);
    await inferAnnotations(catalog, provider);
    const sent = provider.calls[0]![0]!.content;
    expect(sent).toContain("### get_order — GET /api/orders/{orderId}");
    expect(sent).not.toContain("demo@example.com");
  });
});

// Local stand-ins for the two APIs, so the real request code runs without network access.
const servers: Server[] = [];
async function listen(app: express.Express): Promise<string> {
  const server = app.listen(0);
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}
afterAll(() => servers.forEach((s) => s.close()));

describe("OpenAiCompatibleProvider", () => {
  it("asks for strict json_schema output and parses the reply", async () => {
    const requests: any[] = [];
    const app = express().use(express.json({ limit: "5mb" }));
    app.post("/v1/chat/completions", (req, res) => {
      requests.push({ auth: req.get("authorization"), body: req.body });
      res.json({ choices: [{ message: { content: JSON.stringify(good) }, finish_reason: "stop" }] });
    });
    const provider = new OpenAiCompatibleProvider({ baseUrl: `${await listen(app)}/v1`, apiKey: "test-key", model: "grok-test" });
    const { annotations } = await inferAnnotations(catalog, provider);

    expect(annotations.operations.list_products!.tool).toBe("search_products");
    expect(requests[0].auth).toBe("Bearer test-key");
    expect(requests[0].body.model).toBe("grok-test");
    expect(requests[0].body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "annotations", strict: true } });
    expect(requests[0].body.response_format.json_schema.schema.properties.operations.items.properties.operationId.enum).toContain("get_order");
  });

  it("falls back to json_object when the server rejects json_schema", async () => {
    const formats: string[] = [];
    const app = express().use(express.json({ limit: "5mb" }));
    app.post("/chat/completions", (req, res) => {
      formats.push(req.body.response_format.type);
      if (req.body.response_format.type === "json_schema") return void res.status(400).json({ error: "unsupported" });
      res.json({ choices: [{ message: { content: "```json\n" + JSON.stringify(good) + "\n```" } }] });
    });
    const provider = new OpenAiCompatibleProvider({ baseUrl: await listen(app), model: "local" });
    await inferAnnotations(catalog, provider);
    expect(formats).toEqual(["json_schema", "json_object"]);
  });

  it("reports a bad key clearly", async () => {
    const app = express().use(express.json({ limit: "5mb" }));
    app.post("/chat/completions", (_req, res) => void res.status(401).json({ error: "nope" }));
    const provider = new OpenAiCompatibleProvider({ baseUrl: await listen(app), apiKey: "bad", model: "m" });
    await expect(inferAnnotations(catalog, provider)).rejects.toThrow("rejected the API key");
  });
});

describe("AnthropicProvider", () => {
  it("requests structured output with refusal fallback and parses the reply", async () => {
    const requests: any[] = [];
    const app = express().use(express.json({ limit: "5mb" }));
    app.post("/v1/messages", (req, res) => {
      requests.push({ beta: req.get("anthropic-beta"), body: req.body });
      res.json({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: req.body.model,
        content: [{ type: "text", text: JSON.stringify(good) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    });
    process.env.ANTHROPIC_BASE_URL = await listen(app);
    process.env.ANTHROPIC_API_KEY = "test-key";
    try {
      const { annotations } = await inferAnnotations(catalog, new AnthropicProvider());
      expect(annotations.operations.post_login!.kind).toBe("auth");
    } finally {
      delete process.env.ANTHROPIC_BASE_URL;
      delete process.env.ANTHROPIC_API_KEY;
    }
    expect(requests[0].body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { format: { type: "json_schema" } } });
    expect(requests[0].beta).toContain("server-side-fallback-2026-07-01");
  });
});

describe("providerFromEnv", () => {
  it("picks a provider from env and explains what is missing", () => {
    expect(providerFromEnv(undefined, undefined, { SITE2API_LLM_BASE_URL: "https://api.x.ai/v1", SITE2API_LLM_MODEL: "grok" }).label).toBe(
      "openai-compatible:grok@api.x.ai",
    );
    expect(providerFromEnv(undefined, undefined, { ANTHROPIC_API_KEY: "k" }).label).toBe("anthropic:claude-opus-5-5");
    expect(() => providerFromEnv("openai", undefined, { SITE2API_LLM_BASE_URL: "https://x" })).toThrow("SITE2API_LLM_MODEL");
    expect(() => providerFromEnv(undefined, undefined, {})).toThrow(LlmError);
  });
});
