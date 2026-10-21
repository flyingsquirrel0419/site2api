import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateAnnotations } from "../src/infer/annotations.js";
import { renderContext } from "../src/infer/context.js";
import { analyzeHar } from "../src/pipeline.js";
import { readCatalog } from "../src/spec/catalog.js";

const { spec } = analyzeHar(readFileSync(new URL("./fixtures/demo-shop.har", import.meta.url), "utf8"));
const catalog = readCatalog(spec);

describe("readCatalog", () => {
  it("lists REST and GraphQL operations with their inputs, but not the shared GraphQL endpoint", () => {
    expect(catalog.operations.map((op) => [op.id, op.inputs.map((i) => `${i.in}:${i.name}${i.required ? "" : "?"}`)])).toEqual([
      ["post_cart", ["body:productId", "body:quantity?"]],
      ["post_login", ["body:email", "body:password"]],
      ["list_orders", []],
      ["get_order", ["path:orderId"]],
      ["list_products", ["query:page?", "query:q?"]],
      ["get_product", ["path:productId"]],
      ["get_session", []],
      ["graphql_recommendations", ["variables:limit"]],
      ["graphql_viewer", []],
    ]);
  });

  it("knows auth requirements and the login operation", () => {
    const cart = catalog.operations.find((op) => op.id === "post_cart")!;
    expect(cart.auth).toEqual({ bearer: false, cookies: ["sid"], headers: ["x-csrf-token"], apiKeys: [] });
    expect(catalog.operations.filter((op) => op.setsSession).map((op) => op.id)).toEqual(["post_login"]);
  });
});

describe("renderContext", () => {
  it("matches the golden context", async () => {
    await expect(renderContext(catalog)).toMatchFileSnapshot("./__snapshots__/demo-shop.context.md");
  });
});

describe("validateAnnotations", () => {
  const valid = {
    version: 1,
    site: { name: "Demo Shop" },
    operations: {
      list_products: { tool: "search_products", description: "Search the catalog.", params: { q: "Search text" } },
      post_login: { kind: "auth" },
    },
  };

  it("accepts a valid file", () => {
    expect(validateAnnotations(valid, catalog)).toMatchObject({ ok: true });
  });

  it("accepts an empty file", () => {
    expect(validateAnnotations({ version: 1 }, catalog)).toMatchObject({ ok: true });
  });

  it.each([
    [{ version: 2 }, "version"],
    [{ version: 1, operations: { list_products: { tool: "Search-Products" } } }, "operations.list_products.tool: must be snake_case"],
    [{ version: 1, operations: { list_products: { kind: "delete" } } }, "operations.list_products.kind"],
    [{ version: 1, operations: { list_products: { color: "red" } } }, "operations.list_products"],
    [{ version: 1, operations: { nope: {} } }, "operations.nope: unknown operationId. Known ids: post_cart"],
    [
      { version: 1, operations: { list_products: { params: { query: "x" } } } },
      "operations.list_products.params.query: not an input of this operation. Inputs: page, q",
    ],
    [
      { version: 1, operations: { list_products: { tool: "find" }, get_product: { tool: "find" } } },
      'operations.get_product.tool: "find" is already used by operations.list_products',
    ],
    [
      { version: 1, operations: { list_products: { tool: "get_order" } } },
      'operations.list_products.tool: "get_order" collides with the unannotated operation get_order',
    ],
  ])("rejects %j", (raw, message) => {
    const result = validateAnnotations(raw, catalog);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors.join("\n")).toContain(message);
  });
});
