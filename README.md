# site2api

**Turn any website you use into a verified MCP server — in one command.**

> Status: early (v0.2). HAR → OpenAPI → MCP server works end to end. Browser record mode and
> live verification are next.

```bash
npx site2api from-har capture.har -o out    # analyze traffic
npx site2api infer-prompt out               # context for your agent to annotate
npx site2api generate out                   # → out/mcp/server.mjs, ready to register
```

Or skip the commands: install the skill and ask your agent *"make an MCP server from capture.har"*.

## How it works

```
Capture → Normalize → Infer → Generate → Verify → Package
```

| Stage | What it does | Status |
|---|---|---|
| Capture | Import a HAR exported from browser DevTools | ✅ (record mode next) |
| Normalize | Drop static/analytics noise, template paths (`/orders/123` → `/orders/{orderId}`), merge JSON schemas, split GraphQL operations, detect auth shape | ✅ |
| Trace | Find where each input comes from: the order id from the order list, the CSRF token from `/api/session`. Deterministic, no LLM | ✅ |
| Infer | **Your** coding agent (Claude Code, Cursor, Codex, …) names tools, writes descriptions, and marks reads vs. writes, guided by the bundled skill. No API key needed | ✅ |
| Generate | A self-contained MCP server: one `server.mjs` + `tools.json`, no `npm install` | ✅ |
| Verify | Replay read-only operations and validate against the schema | 🚧 next |

The generated server:

- reads credentials only from `SITE2API_COOKIE` / `SITE2API_BEARER`, and never stores them
- fetches CSRF tokens automatically and refreshes them on 403
- leaves out tools that change data unless you pass `--allow-writes`, and even then requires
  `confirm: true` on every call
- rate-limits to 1 request/second by default
- tells the calling agent how to chain tools ("use `orderId` from `list_orders` results")

## The skill

`skills/site2api/SKILL.md` walks any agent that supports [Agent Skills](https://agentskills.io)
through the flow. Copy the folder into one of:

| Agent | Location |
|---|---|
| Cursor | `.agents/skills/` or `.cursor/skills/` (also reads `.claude/skills/`) |
| Claude Code | `.claude/skills/` |
| Codex | `.agents/skills/` or `.codex/skills/` |

## Principles

site2api is for **your own accounts and your own data**.

- **No credential storage.** Cookie and token *values* never reach the spec, report, or generated
  server. Every output is checked against (salted hashes of) the credentials seen in the capture,
  and site2api refuses to write a file that contains one.
- **No bot-detection or CAPTCHA bypass, no proxy rotation, no bulk scraping.** These are non-goals.
- **Write operations are off by default** in generated tools.
- Respect each site's Terms of Service and robots.txt.

## Development

```bash
pnpm install
pnpm test            # unit tests + MCP end-to-end against the demo shop
pnpm demo            # local demo shop on :4317
pnpm record-fixture  # re-record tests/fixtures/demo-shop.har
pnpm build && node dist/cli.js from-har tests/fixtures/demo-shop.har -o out
```

Testing the skill in another agent: [docs/testing-skill.md](docs/testing-skill.md).

## License

MIT
