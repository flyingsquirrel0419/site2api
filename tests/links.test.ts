import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeHar } from "../src/pipeline.js";
import { har } from "./helpers.js";

const label = (op: { method: string; template: string; graphql?: { operationName: string } }) =>
  op.graphql ? `graphql ${op.graphql.operationName}` : `${op.method} ${op.template}`;

describe("dependencies in the demo shop", () => {
  const { dependencies, spec } = analyzeHar(
    readFileSync(new URL("./fixtures/demo-shop.har", import.meta.url), "utf8"),
  );

  it("links order ids from the order list to the order detail", () => {
    expect(
      dependencies.links.map((l) => `${label(l.to)} ${l.target.in}:${l.target.name} ← ${label(l.from)} ${l.pointer} ${l.matches}/${l.samples}`),
    ).toEqual(["GET /api/orders/{orderId} path:orderId ← GET /api/orders /orders/*/id 2/2"]);
  });

  it("finds where the CSRF token and the session cookie come from", () => {
    expect(spec["x-site2api-auth"]).toEqual({
      session: { cookies: ["sid"], setBy: ["post_login"] },
      csrf: { header: "x-csrf-token", source: { operationId: "get_session", status: 200, pointer: "/csrfToken" } },
    });
  });

  it("emits a standard OpenAPI link with a concrete runtime expression", () => {
    const paths = spec.paths as Record<string, Record<string, { responses: Record<string, { links?: unknown }> }>>;
    expect(paths["/api/orders"]!.get!.responses["200"]!.links).toEqual({
      GetOrder: {
        operationId: "get_order",
        parameters: { orderId: "$response.body#/orders/0/id" },
        "x-site2api": { pointer: "/orders/*/id", matches: 2, samples: 2 },
      },
    });
  });
});

describe("findDependencies", () => {
  it("traces a bearer token back to the login response", () => {
    const { dependencies, spec } = analyzeHar(
      har([
        { method: "POST", url: "https://app.com/api/auth", responseBody: { access_token: "eyJ0eXAi.abc123.def456" } },
        { url: "https://app.com/api/me", requestHeaders: { Authorization: "Bearer eyJ0eXAi.abc123.def456" } },
        { url: "https://app.com/api/teams", requestHeaders: { Authorization: "Bearer eyJ0eXAi.abc123.def456" } },
      ]),
    );
    expect(label(dependencies.auth.bearer!.source!.op)).toBe("POST /api/auth");
    expect(spec["x-site2api-auth"]).toEqual({
      bearer: { source: { operationId: "post_auth", status: 200, pointer: "/access_token" } },
    });
  });

  it("links GraphQL variables and request body fields", () => {
    const id = "c0ffee00-1111-4222-8333-944445555666";
    const { dependencies } = analyzeHar(
      har([
        { url: "https://app.com/api/projects", responseBody: { projects: [{ id, name: "Alpha" }] } },
        {
          method: "POST",
          url: "https://app.com/graphql",
          requestBody: { query: "query Project($id: ID!) { project(id: $id) { name } }", variables: { id } },
          responseBody: { data: { project: { name: "Alpha" } } },
        },
        { method: "POST", url: "https://app.com/api/tasks", requestBody: { projectId: id, title: "Write tests" } },
      ]),
    );
    expect(dependencies.links.map((l) => `${label(l.to)} ${l.target.in}:${l.target.name} ← ${l.pointer}`)).toEqual([
      "POST /api/tasks body:/projectId ← /projects/*/id",
      "graphql Project variables:/id ← /projects/*/id",
    ]);
  });

  it("ignores short values and single coincidental matches on plain words", () => {
    const { dependencies } = analyzeHar(
      har([
        { url: "https://app.com/api/items", responseBody: { items: [{ id: 12, tag: "usb" }] } },
        { url: "https://app.com/api/items/12" },
        { url: "https://app.com/api/search?q=usb" },
      ]),
    );
    expect(dependencies.links).toEqual([]);
  });
});
