import { describe, expect, it } from "vitest";
import { segmentKind, singular, templatePaths } from "../src/normalize/template.js";

const templates = (paths: string[]) =>
  Object.fromEntries([...templatePaths(paths)].map(([path, t]) => [path, t.template]));

describe("segmentKind", () => {
  it.each([
    ["123", "integer"],
    ["3f6c2a9e-7b1d-4c8e-9a2f-1d5e8b7c6a40", "uuid"],
    ["5f2b9c0e8a7d4e1f", "hex"],
    ["2026-10-21", "date"],
    ["AbC123xyz_456-QRSTuvw", "token"],
  ])("%s → %s", (segment, kind) => expect(segmentKind(segment)).toBe(kind));

  it.each(["orders", "notification-settings-for-everyone", "v2", "me"])("%s is a literal", (segment) => {
    expect(segmentKind(segment)).toBeUndefined();
  });
});

describe("templatePaths", () => {
  it("parameterizes identifier-shaped segments and names them after the collection", () => {
    expect(
      templates(["/api/orders/3f6c2a9e-7b1d-4c8e-9a2f-1d5e8b7c6a40", "/api/categories/42/items/7"]),
    ).toEqual({
      "/api/orders/3f6c2a9e-7b1d-4c8e-9a2f-1d5e8b7c6a40": "/api/orders/{orderId}",
      "/api/categories/42/items/7": "/api/categories/{categoryId}/items/{itemId}",
    });
  });

  it("keeps sibling collections apart when their parent was never requested", () => {
    expect(templates(["/api/products", "/api/orders", "/api/users"])).toEqual({
      "/api/products": "/api/products",
      "/api/orders": "/api/orders",
      "/api/users": "/api/users",
    });
  });

  it("promotes slugs when 3+ siblings exist and the collection itself was requested", () => {
    const result = templates(["/blog", "/blog/hello-world", "/blog/second-post", "/blog/third-post"]);
    expect(result["/blog/hello-world"]).toBe("/blog/{blogSlug}");
    expect(result["/blog"]).toBe("/blog");
  });

  it("does not promote slugs with only two siblings", () => {
    const result = templates(["/blog", "/blog/hello-world", "/blog/second-post"]);
    expect(result["/blog/hello-world"]).toBe("/blog/hello-world");
  });

  it("collects parameter values and a common kind", () => {
    const map = templatePaths(["/products/1", "/products/2"]);
    expect(map.get("/products/1")).toEqual({
      template: "/products/{productId}",
      params: [{ name: "productId", kind: "integer", values: ["1", "2"] }],
    });
  });
});

describe("singular", () => {
  it.each([
    ["orders", "order"],
    ["categories", "category"],
    ["boxes", "box"],
    ["status", "status"],
    ["address", "address"],
  ])("%s → %s", (word, expected) => expect(singular(word)).toBe(expected));
});
