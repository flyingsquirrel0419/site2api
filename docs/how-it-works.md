# How it works

<p align="center"><img src="assets/flow.svg" alt="Record, normalize, trace, infer, verify, generate" width="900"></p>

Everything except naming the tools is deterministic: the same recording gives the same spec.

## 1. Record

`record` opens Chrome (or Playwright's Chromium) on a dedicated profile with HAR recording on, and
waits for you or a capture script to use the site. `from-har` starts from a HAR you exported
instead. Either way the HAR is parsed into request/response pairs.

## 2. Normalize

**Filter.** Keeps first-party JSON and GraphQL traffic. Drops static files, analytics and
telemetry hosts, `OPTIONS` preflights and third-party origins (unless `--include-origin`). The
first-party site is the most frequent API host's registrable domain (`api.shop.co.kr` → `shop.co.kr`).

**Path templates.** A segment becomes a parameter when its shape is an identifier (number, UUID,
long hex, opaque token, date), or when three or more sibling paths differ only there *and* the
parent collection was itself requested (`/blog` plus `/blog/a`, `/blog/b`, `/blog/c`). The parent
check keeps `/api/products` and `/api/orders` apart. A one- or two-digit segment at the start of
the path or after `api` is a version (`/1/indexes/…`) and stays literal. Parameters are named
after the collection: `/orders/{orderId}`.

**Schemas.** Every sample of a request body, query and response is merged into a JSON Schema: types
are unioned, a field is required only if every sample had it, formats (`uuid`, `date-time`,
`email`, …) are kept when all samples agree. A body that is a JSON object is read as JSON even when
it is labeled as a form (some clients do that to skip CORS preflights).

**Defaults.** An input that had the same value in 2+ samples becomes optional with that default,
unless it is sensitive: only values that redaction would leave unchanged qualify, so emails, phone
numbers, tokens and secrets never do.

**GraphQL.** A request whose body or query string holds a GraphQL document (an operation keyword or
`{ … }`) is split by operation name. A plain `query` field (a search box) is not GraphQL.

**Auth shape.** Cookies sent on 2+ requests (minus analytics cookies), `Authorization: Bearer`,
CSRF-looking headers, and API keys in headers (`x-api-key`) or query parameters (`api_key`,
`x-algolia-api-key`) are detected by name. An operation requires a credential only if every sample
sent it. Values are never kept.

## 3. Trace

For every value a request sent (path and query parameters, body fields, GraphQL variables, CSRF and
API-key headers, bearer tokens), site2api looks for the same value in an *earlier* response:

- `GET /orders/3f6c…` used an id that `GET /orders` returned at `/orders/0/id` → link
  `list_orders /orders/*/id → get_order.orderId`.
- `POST /cart` sent an `x-csrf-token` that `GET /session` returned at `/csrfToken` → the CSRF
  source.
- A bearer token that a login response returned → the bearer source.

A link needs two matches, or one on an identifier-shaped value, so a search term that happens to
equal a tag is not a link. A value the request itself sent and its response merely echoes (search
terms in highlight results) is not counted. Only pointers are kept, never values. Links go into
standard OpenAPI `links` where OpenAPI can express them, and into `x-site2api-links` /
`x-site2api-auth`.

## 4. Infer

`infer-prompt` renders `context.md`: each operation's inputs, response shape (a compact
TypeScript-like summary), auth and links, with no values. An agent (with the skill) or an LLM API
(`infer`) turns it into `annotations.json`, which is validated against the spec: unknown
operation ids, duplicate tool names and unknown input names are errors that name the fix.

A POST to a lookup path (`/search`, `/query`, `/find`, …) is a write until the annotation sets
`kind` to `read`. Other writes cannot be marked read.

## 5. Verify

Read tools are called in dependency order, so linked inputs come from real responses. Responses are
validated against the schema with Ajv. Missing fields are a warning, type changes a failure. See
[Verify](verify.md).

## 6. Generate

`tools.json` describes every tool as data: input schema, HTTP mapping, defaults, auth (which
credentials, which environment variables), CSRF source. `server.mjs` is the same fixed runtime for
every site, bundled with the MCP SDK at build time. The HTTP client it uses is shared with
`verify`, so what verify checked is what the server sends.

## The spec

`openapi.yaml` is valid OpenAPI 3.1 (lint it with any OpenAPI tool), plus:

| Extension | |
|---|---|
| `x-site2api` (per operation) | Sample count, whether it writes, cookies it sets |
| `x-site2api-graphql` | GraphQL operations: query, variables schema, response schema |
| `x-site2api-links` | Every traced input, including body fields and GraphQL variables |
| `x-site2api-auth` | Session cookie and its setter, CSRF header and source, bearer source |
