import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AnnotationsError, generate, SECRETS_FILE } from "../src/generate/generate.js";
import { buildTools } from "../src/generate/tools.js";
import { analyzeHar } from "../src/pipeline.js";
import { SecretLeakError } from "../src/redact.js";
import { readCatalog } from "../src/spec/catalog.js";

const fixture = readFileSync(new URL("./fixtures/demo-shop.har", import.meta.url), "utf8");
const analysis = analyzeHar(fixture);
const catalog = readCatalog(analysis.spec);
const runtimePath = new URL("../dist/runtime/server.mjs", import.meta.url).pathname;

async function outDir(annotations?: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "site2api-"));
  await writeFile(join(dir, "openapi.yaml"), analysis.yaml);
  await mkdir(join(dir, ".site2api"));
  await writeFile(join(dir, SECRETS_FILE), JSON.stringify(analysis.secrets));
  if (annotations !== undefined) await writeFile(join(dir, "annotations.json"), JSON.stringify(annotations));
  return dir;
}

describe("buildTools", () => {
  it("exposes reads, hides login and the CSRF source, and gates writes", () => {
    const readOnly = buildTools(catalog, { version: 1, operations: {} });
    expect(readOnly.tools.map((t) => t.name)).toEqual([
      "list_orders",
      "get_order",
      "list_products",
      "get_product",
      "graphql_recommendations",
      "graphql_viewer",
    ]);
    expect(readOnly.skipped).toEqual([
      { operationId: "post_cart", reason: "changes data (re-run generate with --allow-writes)" },
      { operationId: "post_login", reason: "login/session operation (never exposed)" },
      { operationId: "get_session", reason: "login/session operation (never exposed)" },
    ]);

    const withWrites = buildTools(catalog, { version: 1, operations: {} }, { allowWrites: true });
    const cart = withWrites.tools.find((t) => t.name === "post_cart")!;
    expect(cart.kind).toBe("write");
    expect(cart.auth).toEqual({ cookie: true, bearer: false, csrf: true, apiKeys: [] });
    expect((cart.inputSchema as { required: string[] }).required).toEqual(["productId", "confirm"]);
    expect(withWrites.csrf).toEqual({
      header: "x-csrf-token",
      source: { http: { method: "GET", url: "http://localhost:4317/api/session", inputs: [] }, pointer: "/csrfToken" },
    });
  });

  it("applies annotations and tells the agent how to chain tools", () => {
    const tools = buildTools(catalog, {
      version: 1,
      site: { name: "Demo Shop" },
      operations: {
        list_orders: { tool: "my_orders", description: "List my recent orders." },
        list_products: { tool: "search_products", params: { q: "Search text" } },
        graphql_viewer: { include: false },
      },
    });
    const order = tools.tools.find((t) => t.name === "get_order")!;
    expect(order.description).toContain("Input `orderId`: use a value from `my_orders` results at /orders/*/id.");
    const search = tools.tools.find((t) => t.name === "search_products")!;
    expect(search.inputSchema).toMatchObject({ properties: { q: { type: "string", description: "Search text" } } });
    expect(tools.tools.map((t) => t.name)).not.toContain("graphql_viewer");
  });

  it("matches the golden tools.json", async () => {
    const tools = buildTools(catalog, { version: 1, operations: {} }, { allowWrites: true });
    await expect(JSON.stringify(tools, null, 2) + "\n").toMatchFileSnapshot("./__snapshots__/demo-shop.tools.json");
  });
});

describe("generate", () => {
  it("writes a runnable package", async () => {
    const dir = await outDir({ version: 1, site: { name: "Demo Shop" } });
    const result = await generate(dir, { runtimePath });
    expect(result.warnings).toEqual([
      "Not verified yet: run `site2api verify` to check every read tool against the live site.",
    ]);
    const pkg = JSON.parse(await readFile(join(dir, "mcp", "package.json"), "utf8"));
    expect(pkg).toMatchObject({ name: "demo-shop-mcp", type: "module", bin: "server.mjs" });
    const readme = await readFile(join(dir, "mcp", "README.md"), "utf8");
    expect(readme).toContain("SITE2API_COOKIE");
    expect(readme).toContain("| `get_order` | read |");
    const mcp = JSON.parse(await readFile(join(dir, "mcp", "mcp.json"), "utf8"));
    expect(mcp.mcpServers["demo-shop"]).toEqual({
      command: "node",
      args: [join(dir, "mcp", "server.mjs")],
      env: { SITE2API_COOKIE: "${SITE2API_COOKIE}" },
    });
  });

  it("reports annotation errors for the agent to fix", async () => {
    const dir = await outDir({ version: 1, operations: { nope: {} } });
    await expect(generate(dir, { runtimePath })).rejects.toThrow(AnnotationsError);
  });

  it("refuses to generate when the fingerprint file is missing", async () => {
    const dir = await outDir({ version: 1, site: { name: "Demo Shop" } });
    await rm(join(dir, SECRETS_FILE));
    await expect(generate(dir, { runtimePath })).rejects.toThrow(/secrets\.json/);
  });

  it("skips the fingerprint check only when asked", async () => {
    const dir = await outDir({ version: 1, site: { name: "Demo Shop" } });
    await rm(join(dir, SECRETS_FILE));
    const result = await generate(dir, { runtimePath, allowMissingFingerprint: true });
    expect(result.warnings.some((w) => w.includes("could not be checked"))).toBe(true);
    expect(await readFile(join(dir, "mcp", "tools.json"), "utf8")).toContain("list_orders");
  });

  it("refuses to write a credential the agent pasted into annotations", async () => {
    const sid = /sid=([0-9a-f]+)/.exec(fixture)![1]!;
    const dir = await outDir({
      version: 1,
      operations: { get_order: { description: `Use cookie sid=${sid} to call this.` } },
    });
    await expect(generate(dir, { runtimePath })).rejects.toThrow(SecretLeakError);
  });
});
