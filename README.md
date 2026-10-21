<p align="center">
  <b>English</b> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a>
</p>

<h1 align="center">site2api</h1>

<p align="center"><b>Turn any website you use into a verified MCP server.</b><br>
Use the site once. Your agent gets real tools for it, checked against the live site.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6d4aff" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white" alt="Node 20+">
  <img src="https://img.shields.io/badge/MCP-server-1c2030" alt="MCP">
  <img src="https://img.shields.io/badge/Agent%20Skills-Claude%20Code%20%C2%B7%20Cursor%20%C2%B7%20Codex-1c2030" alt="Agent Skills">
</p>

<p align="center">
  <img src="docs/assets/demo.gif" alt="Searching hn.algolia.com in a browser, site2api turning it into two verified search tools, and an agent answering a question about Rust with this week's stories" width="860">
  <br><sub>A real run on hn.algolia.com: use the site → 2 verified search tools → an agent answers with this week's stories. (Agent: Cursor CLI with Grok; edited for length. <a href="docs/assets/demo.mp4">HD video</a>)</sub>
</p>

---

## The problem

Most of the sites you use every day have no public API: your shop, your bank's dashboard, the
internal tool at work, the forum you read. Their own frontend talks to a perfectly good private
API, but your agent can't see it. So it scrapes HTML, or drives a browser click by click: slow,
brittle, and expensive.

**site2api watches that private API while you use the site, and hands your agent an MCP server
for it.** It figures out the endpoints, the inputs and where they come from, and the login, then
calls every read-only tool against the live site before you ever use it.

## Quick start

> site2api is not on npm yet. Until it is: `git clone`, then `pnpm install && pnpm build && npm link`,
> and use `site2api` wherever this page says `npx site2api`.

**With your coding agent** (Claude Code, Cursor, Codex, … any agent with
[Agent Skills](https://agentskills.io)): copy [`skills/site2api`](skills/site2api) into your
project's `.claude/skills/` or `.agents/skills/`, then ask:

> Make an MCP server for https://app.example.com. I want search, my orders, and order details.

The skill walks the agent through recording, naming the tools, verifying and generating. No API
key needed: your agent does the thinking.

**In one command:**

```bash
npx site2api run https://app.example.com
```

A browser window opens. Log in, use the features you want as tools (twice each is best), and press
Enter. You get `out/mcp/`, a self-contained server:

```bash
claude mcp add app -e SITE2API_COOKIE='…' -- node out/mcp/server.mjs   # or use out/mcp/mcp.json
```

No screen, or running in CI? Let a script drive the browser instead:
`npx site2api run https://app.example.com --script capture.mjs` ([capture scripts](docs/capture-scripts.md)).

## How it works

<p align="center"><img src="docs/assets/flow.svg" alt="Record, normalize, trace, infer, verify, generate" width="900"></p>

| | Stage | What happens |
|---|---|---|
| 1 | **Record** | A browser on a dedicated profile records API calls while you (or a script) use the site. Or bring a HAR from DevTools. |
| 2 | **Normalize** | Drops static files and analytics, turns `/orders/3f6c…` into `/orders/{orderId}`, merges JSON schemas, splits GraphQL operations, detects cookies, bearer tokens, CSRF headers and API keys. |
| 3 | **Trace** | Finds where every input comes from: the order id from the order list, the CSRF token from `/api/session`. Deterministic; no LLM. |
| 4 | **Infer** | Names the tools, writes descriptions, marks each operation read, write or auth. Your coding agent does it with the skill, or `site2api infer` calls Claude or any OpenAI-compatible API. |
| 5 | **Verify** | Calls every read-only tool on the live site and checks the response against the recorded schema. Write and login operations are never called. |
| 6 | **Generate** | `server.mjs` + `tools.json` + `mcp.json`. One file with the MCP SDK bundled in: `node server.mjs`, nothing to install. |

More: [how it works](docs/how-it-works.md).

## What your agent gets

- **Tools that chain.** Descriptions say where inputs come from ("use `orderId` from
  `list_orders` results"), so agents call `list_orders` → `get_order` without guessing.
- **Only what matters as input.** Values that never changed while recording (a client version, a
  page size) become defaults. On hn.algolia.com, the search tool went from 19 required inputs
  to 3.
- **Login handled for it.** Session cookies, bearer tokens and API keys come from environment
  variables; CSRF tokens are fetched and refreshed automatically.
- **Writes behind a gate.** Tools that change data are left out unless you pass
  `--allow-writes`, and even then each call needs `confirm: true`.
- **Clear failures.** An expired session says so. An unreachable site says which host and why.

More: [the generated server](docs/generated-server.md).

## Verified, not just generated

```text
✅ list_orders                  HTTP 200
✅ get_order                    HTTP 200
🟡 search_stories               HTTP 200, but missing: /processingTimingsMS/fetch/total
❌ get_product                  /price: expected number, got string
```

`site2api verify` replays every read tool against the live site, with inputs taken from linked
responses or the recording. **✅** matches. **🟡** works, but some fields that were always present
are missing (usually optional ones). **❌** a type changed or the status was unexpected, so the API
probably changed. `generate --only-verified` keeps ✅ and 🟡. Run it on a schedule to catch API
drift. More: [verify](docs/verify.md).

## How it compares

| | HAR → OpenAPI converters | Browser-driving agents | **site2api** |
|---|---|---|---|
| Output | An OpenAPI file | Clicks, every time | **An MCP server** |
| Speed per call | — | Seconds to minutes | **One HTTP request** |
| Knows where inputs come from | No | Re-discovers each time | **Yes, traced from traffic** |
| Login, CSRF, API keys | Left to you | Per run | **Handled by the server** |
| Checked against the live site | No | — | **Yes (`verify`)** |
| Needs an LLM | No | Every step | **Only to name tools, optional** |

## Principles

site2api is for **your own accounts and your own data**, within each site's terms of service.

- **No credential storage.** Cookie, token and key values never reach the spec, report,
  annotations, verify results or generated server. Every output is checked against salted hashes
  of the credentials seen in the capture, and site2api refuses to write a file that contains one.
- **A plain browser, at a human pace.** Whether you or a script drives it: no stealth, no
  bot-detection or CAPTCHA bypass, no proxy rotation. Scripts have a request budget and a
  minimum pause between steps. Bulk scraping is a non-goal.
- **Writes are off by default**, and `verify` never calls them.

More: [security model](docs/security.md).

## FAQ

**Is this scraping?** No. It calls the same API the site's own frontend calls, as you, at the
rate you would. It does not crawl, and it is built for your own accounts.

**What about sites with CAPTCHAs or bot protection?** site2api does not get around them. If a
site blocks a plain browser, it is not a fit.

**Does it work on a server, without a screen?** Yes. Use a capture script (`--script`) to record
headless, or bring a HAR. Every other step is headless already.

**Which sites work best?** Single-page apps that talk JSON or GraphQL to their backend: shops,
dashboards, SaaS tools, search UIs. Server-rendered HTML pages have no API to find.

**What happens when the site changes?** `verify` tells you which tools broke and how. Record again
and regenerate; it takes a minute.

**Which agents can use the server?** Any MCP client: Claude Code, Cursor, Codex, Claude Desktop,
and others. `out/mcp/mcp.json` works as-is in clients that read the standard `mcpServers` format.

## Documentation

[Getting started](docs/getting-started.md) ·
[CLI reference](docs/cli.md) ·
[Capture scripts](docs/capture-scripts.md) ·
[Using it from your agent](docs/agents.md) ·
[Verify](docs/verify.md) ·
[The generated server](docs/generated-server.md) ·
[How it works](docs/how-it-works.md) ·
[Security model](docs/security.md)

## Development

```bash
pnpm install
pnpm test          # unit tests + MCP, verify and record end to end against the demo shop
pnpm demo          # the demo shop on :4317
pnpm build && node dist/cli.js run http://localhost:4317 --script demo/shop/capture.mjs
```

The demo is reproducible: `node demo/video/render.mjs` (scenes in `demo/video/`). Testing the skill in another agent:
[docs/testing-skill.md](docs/testing-skill.md).

## License

MIT
