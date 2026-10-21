import { describe, expect, it } from "vitest";
import { parseHar } from "../src/capture/har.js";
import { filterExchanges, siteOf } from "../src/normalize/filter.js";
import { har } from "./helpers.js";

describe("siteOf", () => {
  it.each([
    ["api.shop.example.com", "example.com"],
    ["www.shop.co.kr", "shop.co.kr"],
    ["shop.co.kr", "shop.co.kr"],
    ["localhost", "localhost"],
    ["127.0.0.1", "127.0.0.1"],
  ])("%s → %s", (host, site) => expect(siteOf(host)).toBe(site));
});

describe("filterExchanges", () => {
  const exchanges = parseHar(
    har([
      { url: "https://www.shop.com/api/me" },
      { url: "https://api.shop.com/v1/orders" },
      { url: "https://www.shop.com/app.js", responseMime: "text/javascript", responseBody: "x" },
      { url: "https://www.shop.com/", responseMime: "text/html", responseBody: "<html>" },
      { method: "OPTIONS", url: "https://api.shop.com/v1/orders" },
      { url: "https://www.google-analytics.com/g/collect" },
      { url: "https://cdn.other.net/config.json" },
      {
        method: "POST",
        url: "https://www.shop.com/gql",
        responseMime: "text/plain",
        requestBody: { query: "query Me { me { id } }" },
      },
    ]),
  );

  it("keeps first-party JSON and GraphQL, and counts every drop reason", () => {
    const result = filterExchanges(exchanges);
    expect(result.site).toBe("shop.com");
    expect(result.kept.map((e) => e.url.href)).toEqual([
      "https://www.shop.com/api/me",
      "https://api.shop.com/v1/orders",
      "https://www.shop.com/gql",
    ]);
    expect(result.dropped).toEqual({ method: 1, static: 1, analytics: 1, "third-party": 1, "not-json": 1 });
  });

  it("keeps extra origins on request", () => {
    const result = filterExchanges(exchanges, { includeOrigins: ["cdn.other.net"] });
    expect(result.kept.map((e) => e.url.hostname)).toContain("cdn.other.net");
  });
});
