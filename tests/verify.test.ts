import express from "express";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../demo/shop/server.js";
import { buildTools } from "../src/generate/tools.js";
import { analyzeHar } from "../src/pipeline.js";
import { readCatalog } from "../src/spec/catalog.js";
import { schemaErrors, verify } from "../src/verify/verify.js";

const fixture = readFileSync(new URL("./fixtures/demo-shop.har", import.meta.url), "utf8");
const analysis = analyzeHar(fixture);
const catalog = readCatalog(analysis.spec);
const none = { version: 1 as const, operations: {} };

const servers: Server[] = [];
async function listen(app: express.Express): Promise<string> {
  const server = app.listen(0);
  servers.push(server);
  await new Promise((r) => server.once("listening", r));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

let baseUrl: string;
let cookie: string;
beforeAll(async () => {
  baseUrl = await listen(createApp());
  const login = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "demo@example.com", password: "demo-password" }),
  });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});
afterAll(() => servers.forEach((s) => s.close()));

const fixedNow = () => new Date("2026-10-21T00:00:00Z");

describe("verify against the demo shop", () => {
  it("passes every read tool, chaining linked inputs and replaying recorded ones", async () => {
    const report = await verify(catalog, none, {
      credentials: { cookie },
      baseUrl,
      rate: 0,
      recorded: analysis.operations,
      now: fixedNow,
    });
    expect(report.summary).toEqual({ pass: 6, fail: 0, skipped: 0, error: 0 });
    expect(Object.fromEntries(report.results.map((r) => [r.tool, r.inputs]))).toEqual({
      list_orders: {},
      get_order: { orderId: "link" },
      list_products: {}, // the first recorded call had no query string
      get_product: { productId: "recording" },
      graphql_recommendations: { limit: "recording" },
      graphql_viewer: {},
    });
  });

  it("never calls write or auth operations", async () => {
    const report = await verify(catalog, none, { credentials: { cookie }, baseUrl, rate: 0, recorded: analysis.operations });
    const called = report.results.map((r) => r.operationId);
    expect(called).not.toContain("post_cart");
    expect(called).not.toContain("post_login");
    expect(called).not.toContain("get_session");
  });

  it("skips what it cannot call, and says why", async () => {
    const report = await verify(catalog, none, { credentials: {}, baseUrl, rate: 0 });
    const byTool = Object.fromEntries(report.results.map((r) => [r.tool, `${r.status}: ${r.reason ?? ""}`]));
    expect(byTool.list_orders).toBe("skipped: needs a session cookie");
    expect(byTool.get_product).toBe("skipped: needs input: productId (pass --input get_product.productId=…)");
    expect(byTool.list_products).toBe("pass: ");
  });

  it("uses explicit inputs", async () => {
    const report = await verify(catalog, none, { credentials: {}, baseUrl, rate: 0, inputs: { get_product: { productId: "3" } } });
    expect(report.results.find((r) => r.tool === "get_product")).toMatchObject({ status: "pass", inputs: { productId: "user" } });
  });

  it("reports expired credentials as an error", async () => {
    const report = await verify(catalog, none, { credentials: { cookie: "sid=expired" }, baseUrl, rate: 0 });
    expect(report.results.find((r) => r.tool === "list_orders")).toMatchObject({
      status: "error",
      httpStatus: 401,
      reason: "not authorized: credentials missing or expired",
    });
  });

  it("catches a response that no longer matches the recorded shape", async () => {
    const drifted = express();
    drifted.get("/api/products/:id", (_req, res) => {
      res.json({ id: 1, name: "Keyboard", price: "129.00", tags: [] });
    });
    drifted.use(createApp());
    const report = await verify(catalog, none, {
      credentials: {},
      baseUrl: await listen(drifted),
      rate: 0,
      recorded: analysis.operations,
    });
    expect(report.results.find((r) => r.tool === "get_product")).toEqual({
      operationId: "get_product",
      tool: "get_product",
      status: "fail",
      httpStatus: 200,
      inputs: { productId: "recording" },
      errors: ["/discount: missing", "/price: expected number, got string"],
    });
  });
});

describe("schemaErrors", () => {
  it("hints that a missing field may be optional when samples were few", () => {
    const schema = { type: "object", properties: { note: { type: "string" } }, required: ["note"] } as const;
    expect(schemaErrors({ ...schema, required: ["note"] }, {}, 1)).toEqual([
      "/note: missing (schema came from 1 sample(s); the field may be optional)",
    ]);
  });
});

describe("buildTools with verify results", () => {
  const verified = new Map([
    ["list_orders", "pass" as const],
    ["get_order", "fail" as const],
  ]);

  it("records the outcome on each tool", () => {
    const tools = buildTools(catalog, none, { verified });
    expect(tools.tools.find((t) => t.name === "list_orders")!.verified).toBe("pass");
    expect(tools.tools.find((t) => t.name === "get_order")!.verified).toBe("fail");
    expect(tools.tools.find((t) => t.name === "get_product")!.verified).toBeUndefined();
  });

  it("keeps only passing reads with onlyVerified, but keeps allowed writes", () => {
    const tools = buildTools(catalog, none, { verified, onlyVerified: true, allowWrites: true });
    expect(tools.tools.map((t) => t.name)).toEqual(["post_cart", "list_orders"]);
    expect(tools.skipped).toContainEqual({ operationId: "get_order", reason: "did not pass verify (fail)" });
    expect(tools.skipped).toContainEqual({ operationId: "get_product", reason: "did not pass verify (not verified)" });
  });
});

describe("network errors", () => {
  it("names the unreachable origin and the reason instead of 'fetch failed'", async () => {
    // A port that was free a moment ago: nothing is listening there now.
    const closed = express().listen(0);
    await new Promise((r) => closed.once("listening", r));
    const deadUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
    await new Promise((r) => closed.close(r));

    const report = await verify(catalog, none, { credentials: {}, baseUrl: deadUrl, rate: 0, recorded: analysis.operations });
    expect(report.results.find((r) => r.tool === "list_products")).toMatchObject({
      status: "error",
      reason: `could not reach ${deadUrl} (connection refused). Is the site up, and is the base URL right? (SITE2API_BASE_URL / --base-url)`,
    });
  });
});
