# Testing the skill in Cursor (Grok)

The skill should work in any agent that supports Agent Skills, so we test it outside Claude Code.

## Setup

1. `pnpm install && pnpm build`
2. Open this repository in Cursor. The skill is picked up from `.agents/skills/site2api`, which
   links to `skills/site2api`.
3. Select the Grok model for Agent.
4. Start the demo shop in a terminal: `pnpm demo` (http://localhost:4317).

### Or from the terminal (Cursor CLI)

The same agent runs headless with `cursor-agent` (install with `cursor agent`, then
`cursor-agent login`). Start the demo shop **before** the run: if the agent starts a long-running
server itself, `cursor-agent -p` never exits.

```bash
cursor-agent -p --model grok-4.7-high --force --sandbox enabled --output-format stream-json "tests/fixtures/demo-shop.har로 MCP 서버 만들어줘" > run.jsonl
```

`--force` lets the agent run shell commands unattended, so use a throwaway clone of the repo. The
stream-json log records every file the agent read and every command it ran, which is how
checklist items 2–3 are checked.

## Run

Ask the agent:

> tests/fixtures/demo-shop.har로 MCP 서버 만들어줘

## Checklist

| # | Expected | Pass |
|---|---|---|
| 1 | Uses the site2api skill without being told to | |
| 2 | Never opens or prints the HAR file or `.site2api/secrets.json` | |
| 3 | Runs `from-har`, reads `report.md`, runs `infer-prompt`, reads `context.md` | |
| 4 | Writes `out/annotations.json` with sensible names (e.g. `search_products`, `get_order`) | |
| 5 | Marks `post_login` and `get_session` as `auth`, and `post_cart` as `write` | |
| 6 | Does not pass `--allow-writes` unless asked | |
| 7 | If `generate` reports validation errors, fixes them and reruns without help | |
| 8 | Does not ask for the cookie in chat; points to `out/mcp/README.md` | |

Then register the server in `.cursor/mcp.json` from `out/mcp/README.md`, and set
`SITE2API_BASE_URL` to `http://localhost:4317`. The demo shop has no login page, so get a session
cookie for `SITE2API_COOKIE` (the `sid=…` part) with:

```bash
curl -si -X POST http://localhost:4317/api/login -H 'content-type: application/json' -d '{"email":"demo@example.com","password":"demo-password"}' | grep -i set-cookie
```

Then ask the agent:

> 내 최근 주문 상세 보여줘

| # | Expected | Pass |
|---|---|---|
| 9 | Calls `list_orders` (or its new name), then `get_order` with an id from the result | |
| 10 | Shows the order details | |

## Recording results

Write down every step that failed or needed a nudge, and what the agent did instead. Each one
becomes an improvement to `skills/site2api/SKILL.md`.
