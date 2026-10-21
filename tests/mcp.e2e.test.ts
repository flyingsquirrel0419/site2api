// Generates an MCP server from the demo shop capture, runs it as a real stdio process against a
// live demo shop, and drives it with the MCP client SDK.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../demo/shop/server.js";
import { generate, SECRETS_FILE } from "../src/generate/generate.js";
import { analyzeHar } from "../src/pipeline.js";

const runtimePath = new URL("../dist/runtime/server.mjs", import.meta.url).pathname;

let shop: Server;
let baseUrl: string;
let cookie: string;
let serverPath: string;
const clients: Client[] = [];

async function connect(env: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "e2e", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: { PATH: process.env.PATH ?? "", SITE2API_BASE_URL: baseUrl, SITE2API_RATE: "0", ...env },
      stderr: "ignore",
    }),
  );
  clients.push(client);
  return client;
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
}

beforeAll(async () => {
  shop = createApp().listen(0);
  await new Promise((r) => shop.once("listening", r));
  baseUrl = `http://localhost:${(shop.address() as AddressInfo).port}`;

  const login = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "demo@example.com", password: "demo-password" }),
  });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;

  const analysis = analyzeHar(readFileSync(new URL("./fixtures/demo-shop.har", import.meta.url), "utf8"));
  const dir = await mkdtemp(join(tmpdir(), "site2api-e2e-"));
  await writeFile(join(dir, "openapi.yaml"), analysis.yaml);
  await mkdir(join(dir, ".site2api"));
  await writeFile(join(dir, SECRETS_FILE), JSON.stringify(analysis.secrets));
  await writeFile(
    join(dir, "annotations.json"),
    JSON.stringify({
      version: 1,
      site: { name: "Demo Shop" },
      operations: {
        list_products: { tool: "search_products", description: "Search the catalog.", params: { q: "Search text" } },
        post_cart: { tool: "add_to_cart", description: "Add a product to the cart." },
      },
    }),
  );
  serverPath = join((await generate(dir, { allowWrites: true, runtimePath })).outDir, "server.mjs");
});

afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  shop?.close();
});

describe("generated MCP server", () => {
  it("lists tools without login or the CSRF source", async () => {
    const client = await connect({ SITE2API_COOKIE: cookie });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_to_cart",
      "get_order",
      "get_product",
      "graphql_recommendations",
      "graphql_viewer",
      "list_orders",
      "search_products",
    ]);
    expect(tools.find((t) => t.name === "add_to_cart")!.annotations).toMatchObject({ destructiveHint: true });
  });

  it("calls public, cookie-authenticated and GraphQL tools", async () => {
    const client = await connect({ SITE2API_COOKIE: cookie });

    const search = await client.callTool({ name: "search_products", arguments: { q: "hub" } });
    expect(search.isError).toBeFalsy();
    expect(text(search)).toContain("USB-C Hub");

    const list = await client.callTool({ name: "list_orders", arguments: {} });
    const orderId = /"id": "([0-9a-f-]{36})"/.exec(text(list))![1]!;
    const order = await client.callTool({ name: "get_order", arguments: { orderId } });
    expect(text(order)).toContain('"status"');

    const viewer = await client.callTool({ name: "graphql_viewer", arguments: {} });
    expect(text(viewer)).toContain('"orderCount": 2');
    const recs = await client.callTool({ name: "graphql_recommendations", arguments: { limit: 1 } });
    expect(text(recs)).toContain("Mechanical Keyboard");
    expect(text(recs)).not.toContain("USB-C Hub");
  });

  it("requires confirm for writes, then fetches the CSRF token automatically", async () => {
    const client = await connect({ SITE2API_COOKIE: cookie });
    const refused = await client.callTool({ name: "add_to_cart", arguments: { productId: 2 } });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("confirm: true");

    const added = await client.callTool({ name: "add_to_cart", arguments: { productId: 2, quantity: 1, confirm: true } });
    expect(added.isError).toBeFalsy();
    expect(text(added)).toMatch(/^HTTP 201/);
  });

  it("explains missing or expired credentials", async () => {
    const anonymous = await connect({});
    const noCookie = await anonymous.callTool({ name: "list_orders", arguments: {} });
    expect(text(noCookie)).toContain("Set SITE2API_COOKIE");

    const expired = await connect({ SITE2API_COOKIE: "sid=expired-session-value" });
    const res = await expired.callTool({ name: "list_orders", arguments: {} });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("may have expired");
  });
});
