// Regression tests for the security audit: credentials that must not reach any output, and
// what the runtime must refuse to send. Every value here is made up.
import { spawn } from "node:child_process";
import express from "express";
import { mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HttpCall, ToolAuth } from "../src/generate/types.js";
import { buildTools } from "../src/generate/tools.js";
import { validateAnnotations } from "../src/infer/annotations.js";
import { renderContext } from "../src/infer/context.js";
import { OpenAiCompatibleProvider } from "../src/infer/llm/openai.js";
import { siteOf } from "../src/normalize/filter.js";
import { analyzeHar } from "../src/pipeline.js";
import { assertNoFingerprintedSecrets } from "../src/redact.js";
import { HttpClient, parseRate } from "../src/runtime/http.js";
import { loadRecordedOperations } from "../src/verify/recorded.js";
import { readCatalog } from "../src/spec/catalog.js";
import { har, type EntrySpec } from "./helpers.js";

const COOKIE = { cookie: "sid=SIDVALUE123" };
const twice = (e: EntrySpec) => [e, e];

describe("credentials without an obvious name stay out of every output", () => {
  const capture = har([
    ...twice({ method: "POST", url: "https://app.example.com/api/login", requestHeaders: COOKIE, requestBody: { username: "bob", pwd: "HUNTERPWD22" } }),
    ...twice({
      method: "POST",
      url: "https://app.example.com/api/login2",
      requestHeaders: COOKIE,
      requestMime: "application/x-www-form-urlencoded",
      rawRequestBody: "user=bob&pw=FORMPW9988",
    }),
    ...twice({ method: "POST", url: "https://app.example.com/api/verify", requestHeaders: COOKIE, requestBody: { auth: { user: "bob", code: "OTPCODE7788" } } }),
    ...twice({ url: "https://app.example.com/api/files?access_key=AKIAIOSFODNN7EXAMPLE&sig=SIGabc123def", requestHeaders: COOKIE }),
    ...twice({ url: "https://app.example.com/api/share/MagicTok9x7Q", requestHeaders: COOKIE }),
    ...twice({
      method: "POST",
      url: "https://app.example.com/graphql",
      requestHeaders: COOKIE,
      requestBody: { query: 'mutation Login { login(email: "bob@x.io", password: "GQLPASS4455") { token } }' },
    }),
  ]);
  const leaks = ["HUNTERPWD22", "FORMPW9988", "OTPCODE7788", "AKIAIOSFODNN7EXAMPLE", "SIGabc123def", "MagicTok9x7Q", "GQLPASS4455", "bob@x.io"];

  it("in the spec, the report and the LLM context", () => {
    const result = analyzeHar(capture);
    const context = renderContext(readCatalog(result.spec));
    for (const output of [result.yaml, result.report, context]) {
      for (const value of leaks) expect(output).not.toContain(value);
    }
  });

  it("and the fingerprint gate knows them, also inside URLs and punctuation", () => {
    const { secrets } = analyzeHar(capture);
    for (const text of ["?pw=FORMPW9988&x=1", "/s/HUNTERPWD22/x", "code:OTPCODE7788", "SIGabc123def!", 'password: "GQLPASS4455"']) {
      expect(() => assertNoFingerprintedSecrets(text, secrets, "test")).toThrow(/captured as credentials/);
    }
    expect(() => assertNoFingerprintedSecrets("nothing secret here", secrets, "test")).not.toThrow();
  });

  it("matches a cookie echoed URL-decoded", () => {
    const { secrets } = analyzeHar(har([{ url: "https://app.example.com/api/me", requestHeaders: { cookie: "sid=abc%2Bdef9876" } }]));
    expect(() => assertNoFingerprintedSecrets("value abc+def9876", secrets, "test")).toThrow();
  });
});

it("a response key named __proto__ is an ordinary property", () => {
  const capture = har([
    { url: "https://app.example.com/api/me", responseBody: JSON.parse('{"__proto__": {"types": ["x"]}, "a": 1}') },
    { url: "https://app.example.com/api/me", responseBody: { types: 1, a: 2 } },
  ]);
  expect(() => analyzeHar(capture)).not.toThrow();
});

describe("annotations cannot make an operation riskier", () => {
  const capture = har([
    { method: "DELETE", url: "https://app.example.com/api/items/1", requestHeaders: COOKIE },
    { method: "GET", url: "https://app.example.com/api/items", requestHeaders: COOKIE, responseBody: [{ id: 1 }] },
  ]);
  const catalog = readCatalog(analyzeHar(capture).spec);
  const del = catalog.operations.find((op) => op.method === "DELETE")!;

  it("rejects kind read on a DELETE", () => {
    const result = validateAnnotations({ version: 1, operations: { [del.id]: { kind: "read" } } }, catalog);
    expect(result.ok).toBe(false);
  });

  it("keeps it a write even if such annotations reach generate", () => {
    const tools = buildTools(catalog, { version: 1, operations: { [del.id]: { kind: "read" } } }, { allowWrites: true });
    expect(tools.tools.find((t) => t.operationId === del.id)?.kind).toBe("write");
  });
});

describe("the runtime HTTP client", () => {
  const noAuth: ToolAuth = { cookie: true, bearer: true, csrf: false, apiKeys: [] };

  async function serve(handler: express.RequestHandler): Promise<{ base: string; close: () => void }> {
    const app = express();
    app.use(handler);
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
  }

  const call = (base: string, path = "/users/{id}/posts"): HttpCall => ({
    method: "GET",
    url: `${base}${path}`,
    inputs: [{ name: "id", in: "path", source: "id" }],
  });

  it("refuses . and .. as path values, which would change the endpoint", async () => {
    const seen: string[] = [];
    const { base, close } = await serve((req, res) => void (seen.push(req.path), res.json({})));
    try {
      const client = new HttpClient({ recordedBaseUrl: base, rate: 0, credentials: {} });
      for (const id of ["..", ".", "", "a/../b", "a\\..\\b", "%2e%2e", "%2F"]) {
        await expect(client.call(call(base), { id }, noAuth)).rejects.toThrow(/part of the URL path/);
      }
      await client.call(call(base), { id: "ok" }, noAuth);
      expect(seen).toEqual(["/users/ok/posts"]);
    } finally {
      close();
    }
  });

  it("does not read inputs from Object.prototype", async () => {
    let url = "";
    const { base, close } = await serve((req, res) => void ((url = req.url), res.json({})));
    try {
      const client = new HttpClient({ recordedBaseUrl: base, rate: 0, credentials: {} });
      const http: HttpCall = { method: "GET", url: `${base}/x`, inputs: [{ name: "constructor", in: "query", source: "c" }] };
      await client.call(http, {}, noAuth);
      expect(url).toBe("/x");
    } finally {
      close();
    }
  });

  it("sends the session cookie and token only to the recorded site", async () => {
    const headers: Record<string, string | undefined>[] = [];
    const { base, close } = await serve((req, res) => void (headers.push({ cookie: req.headers.cookie, auth: req.headers.authorization }), res.json({})));
    try {
      const credentials = { cookie: "sid=SIDVALUE123", bearer: "BEARER123456" };
      // Recorded on another site: the request still goes out, without credentials.
      await new HttpClient({ recordedBaseUrl: "https://app.example.com", rate: 0, credentials }).send(call(base), { id: "1" }, noAuth, {});
      await new HttpClient({ recordedBaseUrl: base, rate: 0, credentials }).send(call(base), { id: "1" }, noAuth, {});
      expect(headers).toEqual([{ cookie: undefined, auth: undefined }, { cookie: "sid=SIDVALUE123", auth: "Bearer BEARER123456" }]);
    } finally {
      close();
    }
  });

  it("rejects a rate that would silently disable the limit", () => {
    expect(() => parseRate("nope", "--rate")).toThrow(/--rate/);
    expect(() => parseRate("-5", "--rate")).toThrow(/--rate/);
    expect(parseRate("0", "--rate")).toBe(0);
    expect(() => new HttpClient({ recordedBaseUrl: "https://app.example.com", rate: Number("nope"), credentials: {} })).toThrow(/rate/);
  });

  it("refuses SITE2API_TOOLS that is not the tools.json beside the server", async () => {
    const dir = await mkdtemp(join(tmpdir(), "site2api-tools-"));
    const tools = join(dir, "tools.json");
    await writeFile(tools, "{}\n");
    const serverPath = new URL("../dist/runtime/server.mjs", import.meta.url).pathname;
    const output = await new Promise<{ code: number | null; text: string }>((resolve) => {
      const child = spawn(process.execPath, [serverPath], {
        env: { PATH: process.env.PATH ?? "", SITE2API_TOOLS: tools },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let text = "";
      child.stderr.on("data", (b) => (text += b));
      const killer = setTimeout(() => child.kill(), 3000);
      child.on("exit", (code) => {
        clearTimeout(killer);
        resolve({ code, text });
      });
    });
    expect(output.code).toBe(1);
    expect(output.text).toContain("refusing SITE2API_TOOLS");
  });

  it("cuts off huge bodies and gives up on servers that never answer", async () => {
    const { base, close } = await serve((req, res) => {
      if (req.path.startsWith("/users/big")) return void res.send("x".repeat(5000));
      // /users/slow: never answers
    });
    try {
      const client = new HttpClient({ recordedBaseUrl: base, rate: 0, credentials: {}, maxResponseBytes: 1000, timeoutMs: 300 });
      const big = await client.call(call(base), { id: "big" }, noAuth);
      expect(big.text.length).toBe(1000);
      expect(big.truncated).toBe(true);
      await expect(client.call(call(base), { id: "slow" }, noAuth)).rejects.toThrow(/did not answer within/);
    } finally {
      close();
    }
  });
});

it("treats subdomains of shared hosting as separate sites", () => {
  expect(siteOf("alice.github.io")).toBe("alice.github.io");
  expect(siteOf("www.alice.github.io")).toBe("alice.github.io");
  expect(siteOf("api.example.com")).toBe("example.com");
  expect(siteOf("shop.example.co.kr")).toBe("example.co.kr");
});

it("stops verify when the capture cannot be read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "site2api-har-"));
  const bad = join(dir, "broken.har");
  await writeFile(bad, "{ this is not a har");
  await expect(loadRecordedOperations(bad)).rejects.toThrow(/Verify stopped/);
  await expect(loadRecordedOperations(join(dir, "missing.har"))).rejects.toThrow(/Verify stopped/);
});

it("refuses to send the LLM key over plain http, except to localhost", () => {
  expect(() => new OpenAiCompatibleProvider({ baseUrl: "http://api.example.com/v1", model: "m" })).toThrow(/https/);
  expect(() => new OpenAiCompatibleProvider({ baseUrl: "http://localhost:11434/v1", model: "m" })).not.toThrow();
});
