# site2api

**Turn any website you use into a verified MCP server — in one command.**

> Status: early. v0.1 ships the deterministic core: HAR → normalized OpenAPI 3.1 spec + report.

```bash
npx site2api from-har capture.har -o out/
```

## How it works

```
Capture → Normalize → Infer → Generate → Verify → Package
```

| Stage | What it does | Status |
|---|---|---|
| Capture | Import a HAR (record mode coming) | ✅ HAR import |
| Normalize | Drop static/analytics noise, template paths (`/orders/123` → `/orders/{orderId}`), merge JSON schemas, split GraphQL operations, detect auth shape | ✅ |
| Infer | Your coding agent names operations and traces request dependencies (via the bundled skill) | 🚧 v0.2 |
| Generate | OpenAPI → typed SDK + MCP server | 🚧 v0.2 |
| Verify | Replay read-only operations and validate against the schema | 🚧 v0.3 |

## Principles

site2api is for **your own accounts and your own data**.

- **No credential storage.** Cookie and token *values* never reach the spec or report — only their names.
- **No bot-detection or CAPTCHA bypass, no proxy rotation, no bulk scraping.** These are non-goals.
- **Write operations are off by default** in generated tools.
- Respect each site's Terms of Service and robots.txt.

## Development

```bash
pnpm install
pnpm test
pnpm demo            # local demo shop on :4317
pnpm record-fixture  # re-record tests/fixtures/demo-shop.har
pnpm build && node dist/cli.js from-har tests/fixtures/demo-shop.har -o out/
```

## License

MIT
