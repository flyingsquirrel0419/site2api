# site2api

**Turn any website you use into a verified MCP server — in one command.**

```bash
npx site2api run https://app.example.com
```

A browser opens. Use the site as usual (search, open a list, open an item), then press Enter.
site2api analyzes the traffic, names the tools, calls each read-only one against the live site to
verify it, and writes an MCP server you can register with Claude Code, Cursor, Codex or any MCP client.

> Status: early (v0.3). Works end to end; not on npm yet (run from source, see Development).

## How it works

```
Record → Normalize → Trace → Infer → Verify → Generate
```

| Stage | What it does | |
|---|---|---|
| Record | A normal browser window on a dedicated profile records the API calls while you use the site. Or bring a HAR from DevTools | `record`, `from-har` |
| Normalize | Drops static/analytics noise, templates paths (`/orders/123` → `/orders/{orderId}`), merges JSON schemas, splits GraphQL operations, detects the auth shape | |
| Trace | Finds where each input comes from: the order id from the order list, the CSRF token from `/api/session`. Deterministic, no LLM | |
| Infer | Names tools, writes descriptions, marks reads vs. writes. Either **your coding agent** does it with the bundled skill (no API key), or `site2api infer` calls Claude or any OpenAI-compatible API (Grok, OpenRouter, Ollama, …) | `infer-prompt`, `infer` |
| Verify | Calls every read-only operation on the live site and checks the response against the recorded schema. Write and auth operations are never called | `verify` |
| Generate | A self-contained MCP server: one `server.mjs` + `tools.json`, no `npm install` | `generate` |

`run` chains them all. Each stage also runs on its own:

```bash
site2api record https://app.example.com -o out   # or: site2api from-har capture.har -o out
site2api infer out                               # or let your agent annotate (site2api infer-prompt out)
SITE2API_COOKIE='…' site2api verify out
site2api generate out --only-verified
```

### The generated server

- reads credentials only from `SITE2API_COOKIE` / `SITE2API_BEARER`, and never stores them
- fetches CSRF tokens automatically and refreshes them on 403
- leaves out tools that change data unless you pass `--allow-writes`, and even then requires
  `confirm: true` on every call
- rate-limits to 1 request/second by default
- tells the calling agent how to chain tools ("use `orderId` from `list_orders` results")

### Annotating with an LLM API

| Provider | Environment |
|---|---|
| Claude (`--provider anthropic`) | `ANTHROPIC_API_KEY`. Default model `claude-opus-5-5`; `--model` to change |
| OpenAI-compatible (`--provider openai`) | `SITE2API_LLM_BASE_URL` (e.g. `https://api.x.ai/v1`), `SITE2API_LLM_MODEL`, `SITE2API_LLM_API_KEY` |

Only the value-free summary of the API is sent (`infer/context.md`): no cookies, tokens, or
response data. The answer is validated, and errors go back to the model for up to 3 attempts.

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

- **No credential storage.** Cookie and token *values* never reach the spec, report, annotations,
  verify results or generated server. Every output is checked against salted hashes of the
  credentials seen in the capture, and site2api refuses to write a file that contains one.
  The cookies `run` uses for verification stay in memory.
- **A person drives the browser.** `record` is a normal browser window: no stealth, no
  bot-detection or CAPTCHA bypass, no proxy rotation, no bulk scraping. These are non-goals.
- **Write operations are off by default**, and verify never calls them.
- Respect each site's Terms of Service and robots.txt.

## Development

```bash
pnpm install
pnpm test            # unit tests + MCP, verify and record end-to-end against the demo shop
pnpm demo            # local demo shop on :4317
pnpm build && node dist/cli.js run http://localhost:4317
```

`pnpm record-fixture` re-records `tests/fixtures/demo-shop.har`. Testing the skill in another
agent: [docs/testing-skill.md](docs/testing-skill.md).

## License

MIT
