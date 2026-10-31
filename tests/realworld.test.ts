// Shapes found by running site2api on a real site (hn.algolia.com) with Grok: a search API that
// posts JSON under a form content type, takes its API key in the query string, sits under a
// version segment, repeats fixed client parameters on every call, and echoes the search term.
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTools } from "../src/generate/tools.js";
import { validateAnnotations } from "../src/infer/annotations.js";
import { analyzeHar } from "../src/pipeline.js";
import { HttpClient } from "../src/runtime/http.js";
import { readCatalog } from "../src/spec/catalog.js";
import { verify } from "../src/verify/verify.js";
import { har } from "./helpers.js";

const KEY = "pub-search-key-1234567890";
const AGENT = "Search for JavaScript (4.13.1); Browser (lite)";

let server: Server;
let base: string;
const received: { query: Record<string, unknown>; body: Record<string, unknown> }[] = [];

beforeAll(async () => {
  const app = express();
  // Like Algolia: the body is JSON whatever the content type says.
  app.use(express.text({ type: "*/*" }));
  app.post("/1/indexes/Items/query", (req, res) => {
    if (req.query["x-api-key"] !== KEY) return void res.status(403).json({ message: "Invalid API key" });
    const body = JSON.parse(req.body as string) as Record<string, unknown>;
    received.push({ query: req.query as Record<string, unknown>, body });
    const q = String(body.query);
    res.json({
      hits: [{ title: `${q} in 2026`, points: 120, _tags: ["story"], _highlightResult: { title: { matchedWords: [q] } } }],
      nbHits: 1,
    });
  });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

function capture(origin: string) {
  const search = (query: string) => ({
    method: "POST",
    url: `${origin}/1/indexes/Items/query?x-api-key=${KEY}&x-agent=${encodeURIComponent(AGENT)}&x-application-id=APP42`,
    requestMime: "application/x-www-form-urlencoded",
    requestBody: { query, page: 0, hitsPerPage: 20, typoTolerance: true, tagFilters: [["story"], []] },
    responseBody: {
      hits: [{ title: `${query} in 2026`, points: 120, _tags: ["story"], _highlightResult: { title: { matchedWords: [query] } } }],
      nbHits: 1,
    },
  });
  return har([search("rust"), search("python"), search("golang")]);
}

describe("an Algolia-style search API", () => {
  const analysis = analyzeHar(capture("https://search.example.com"));
  const spec = analysis.spec as any;
  const op = spec.paths["/1/indexes/Items/query"]?.post;

  it("keeps the version segment literal and does not mistake `query` for GraphQL", () => {
    expect(Object.keys(spec.paths)).toEqual(["/1/indexes/Items/query"]);
    expect(spec["x-site2api-graphql"]).toBeUndefined();
  });

  it("reads the JSON body despite the form content type", () => {
    expect(Object.keys(op.requestBody.content)).toEqual(["application/json"]);
    expect(Object.keys(op.requestBody.content["application/json"].schema.properties)).toEqual([
      "query",
      "page",
      "hitsPerPage",
      "typoTolerance",
      "tagFilters",
    ]);
  });

  it("treats the query-string API key as a credential, not an input", () => {
    expect(spec.components.securitySchemes).toEqual({ "query_x-api-key": { type: "apiKey", in: "query", name: "x-api-key" } });
    expect(op.security).toEqual([{ "query_x-api-key": [] }]);
    expect(op.parameters.map((p: { name: string }) => p.name)).toEqual(["x-agent", "x-application-id"]);
    expect(analysis.yaml).not.toContain(KEY);
  });

  it("turns values that never changed into optional inputs with defaults", () => {
    const schema = op.requestBody.content["application/json"].schema;
    expect(schema.required).toEqual(["query"]);
    expect(schema.properties.hitsPerPage.default).toBe(20);
    expect(schema.properties.typoTolerance.default).toBe(true);
    expect(schema.properties.tagFilters.default).toEqual([["story"], []]);
    expect(schema.properties.query.default).toBeUndefined();
    expect(op.parameters.find((p: { name: string }) => p.name === "x-agent")).toMatchObject({ required: false, schema: { default: AGENT } });
  });

  it("does not link the search term to its own echo in the results", () => {
    expect(analysis.dependencies.links).toEqual([]);
  });

  it("generates a tool whose only required input is the query, with the key from env", () => {
    const tools = buildTools(readCatalog(spec), { version: 1, operations: { post_query: { kind: "read" } } });
    const tool = tools.tools.find((t) => t.operationId === "post_query")!;
    expect((tool.inputSchema as { required: string[] }).required).toEqual(["query"]);
    expect(tool.auth.apiKeys).toEqual([{ in: "query", name: "x-api-key", env: "SITE2API_KEY_X_API_KEY" }]);
    expect(JSON.stringify(tools)).not.toContain(KEY);
  });
});

describe("against a live Algolia-style server", () => {
  it("sends defaults and the API key, and verifies with the recorded key", async () => {
    const analysis = analyzeHar(capture(base));
    const catalog = readCatalog(analysis.spec);
    const annotations = { version: 1 as const, operations: { post_query: { kind: "read" as const } } };

    const report = await verify(catalog, annotations, { credentials: {}, rate: 0, recorded: analysis.operations });
    expect(report.results).toMatchObject([{ operationId: "post_query", status: "pass" }]);
    expect(JSON.stringify(report)).not.toContain(KEY);

    received.length = 0;
    const tool = buildTools(catalog, annotations).tools[0]!;
    const client = new HttpClient({ recordedBaseUrl: base, rate: 0, credentials: { apiKeys: { "x-api-key": KEY } } });
    const res = await client.call(tool.http, { query: "zig" }, tool.auth);
    expect(res.status).toBe(200);
    expect(received[0]).toEqual({
      query: { "x-api-key": KEY, "x-agent": AGENT, "x-application-id": "APP42" },
      body: { query: "zig", page: 0, hitsPerPage: 20, typoTolerance: true, tagFilters: [["story"], []] },
    });
  });
});

describe("constant defaults never store personal data", () => {
  it("skips emails, phone numbers and sensitive fields even when they repeat", () => {
    const login = {
      method: "POST",
      url: "https://app.example.com/api/login",
      requestBody: { email: "kim@corp.kr", password: "hunter2-long", phone: "+82-10-1234-5678", remember: true },
    };
    const spec = analyzeHar(har([login, login])).spec as any;
    const props = spec.paths["/api/login"].post.requestBody.content["application/json"].schema.properties;
    expect(props.email.default).toBeUndefined();
    expect(props.password.default).toBeUndefined();
    expect(props.phone.default).toBeUndefined();
    expect(props.remember.default).toBe(true);
  });
});

describe("API keys in headers", () => {
  it("are sent by the runtime from env (they were detected but never sent before)", async () => {
    let seen: string | undefined;
    const app = express();
    app.get("/v2/items", (req, res) => {
      seen = req.get("x-api-key");
      res.json({ items: [] });
    });
    const s = app.listen(0);
    await new Promise((r) => s.once("listening", r));
    const origin = `http://localhost:${(s.address() as AddressInfo).port}`;
    try {
      const capture = har([1, 2].map(() => ({ url: `${origin}/v2/items`, requestHeaders: { "x-api-key": "hdr-key-0987654321" }, responseBody: { items: [] } })));
      const tool = buildTools(readCatalog(analyzeHar(capture).spec), { version: 1, operations: {} }).tools[0]!;
      expect(tool.auth.apiKeys).toEqual([{ in: "header", name: "x-api-key", env: "SITE2API_KEY_X_API_KEY" }]);
      const client = new HttpClient({ recordedBaseUrl: origin, rate: 0, credentials: { apiKeys: { "x-api-key": "from-env" } } });
      await client.call(tool.http, {}, tool.auth);
      expect(seen).toBe("from-env");
    } finally {
      s.close();
    }
  });
});

describe("default kinds", () => {
  it("keeps a POST to a lookup path as a write until an annotation says it only reads", () => {
    const catalog = readCatalog(analyzeHar(capture("https://search.example.com")).spec);
    const tools = buildTools(catalog, { version: 1, operations: {} });
    expect(tools.tools).toEqual([]);
    expect(tools.skipped).toEqual([{ operationId: "post_query", reason: "changes data (re-run generate with --allow-writes)" }]);

    const opted = buildTools(catalog, { version: 1, operations: { post_query: { kind: "read" } } });
    expect(opted.tools.map((t) => [t.operationId, t.kind])).toEqual([["post_query", "read"]]);
    expect(validateAnnotations({ version: 1, operations: { post_query: { kind: "read" } } }, catalog).ok).toBe(true);

    const cartHar = har([1, 2].map((n) => ({ method: "POST", url: "https://shop.example.com/api/cart", requestBody: { productId: n } })));
    const cart = readCatalog(analyzeHar(cartHar).spec);
    expect(buildTools(cart, { version: 1, operations: {} }).skipped).toEqual([
      { operationId: "post_cart", reason: "changes data (re-run generate with --allow-writes)" },
    ]);
    expect(validateAnnotations({ version: 1, operations: { post_cart: { kind: "read" } } }, cart).ok).toBe(false);
  });
});
