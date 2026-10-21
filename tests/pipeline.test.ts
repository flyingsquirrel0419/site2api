import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHar } from "../src/capture/har.js";
import { analyzeHar } from "../src/pipeline.js";
import { collectSecrets } from "../src/redact.js";

const fixture = readFileSync(new URL("./fixtures/demo-shop.har", import.meta.url), "utf8");

describe("demo shop end to end", () => {
  const result = analyzeHar(fixture, { source: "demo-shop.har" });

  it("finds every REST endpoint with templated paths", () => {
    const rest = result.operations.filter((op) => !op.graphql).map((op) => `${op.method} ${op.template}`);
    expect(rest).toEqual([
      "POST /api/cart",
      "POST /api/login",
      "GET /api/orders",
      "GET /api/orders/{orderId}",
      "GET /api/products",
      "GET /api/products/{productId}",
      "GET /api/session",
    ]);
  });

  it("splits GraphQL operations by name", () => {
    expect(result.operations.filter((op) => op.graphql).map((op) => op.graphql!.operationName)).toEqual([
      "Recommendations",
      "Viewer",
    ]);
  });

  it("detects the cookie session and the CSRF header", () => {
    const schemes = (result.spec.components as { securitySchemes: Record<string, unknown> }).securitySchemes;
    expect(Object.keys(schemes).sort()).toEqual(["cookie_sid", "header_x-csrf-token"]);
    const cart = result.operations.find((op) => op.template === "/api/cart")!;
    expect(cart.auth.cookies).toEqual(["sid"]);
    expect(cart.auth.csrfHeaders).toEqual(["x-csrf-token"]);
    const products = result.operations.find((op) => op.template === "/api/products")!;
    expect(products.auth.cookies).toEqual([]);
  });

  it("never writes captured credential values, even with examples on", () => {
    const secrets = collectSecrets(parseHar(fixture));
    expect(secrets.length).toBeGreaterThan(2); // sid cookie, csrf token, password
    const withExamples = analyzeHar(fixture, { examples: true });
    for (const output of [result.yaml, result.report, withExamples.yaml]) {
      for (const secret of secrets) expect(output).not.toContain(secret);
    }
    expect(withExamples.yaml).not.toContain("demo@example.com");
  });

  it("matches the golden spec and report", async () => {
    await expect(result.yaml).toMatchFileSnapshot("./__snapshots__/demo-shop.openapi.yaml");
    await expect(result.report).toMatchFileSnapshot("./__snapshots__/demo-shop.report.md");
  });
});
