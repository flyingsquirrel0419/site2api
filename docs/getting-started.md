# Getting started

This walks through one site from nothing to an agent calling it. It takes about five minutes.

## Install

site2api needs Node.js 20 or newer. It is not on npm yet, so install it from source:

```bash
git clone https://github.com/flyingsquirrel0419/site2api && cd site2api
pnpm install && pnpm build && npm link
```

`npm link` puts `site2api` on your PATH. Recording uses Playwright and your installed Chrome; if
you have no Chrome, run `npx playwright install chromium` once.

To try everything without touching a real site, start the bundled demo shop in another terminal:

```bash
pnpm demo   # http://localhost:4317
```

## 1. Record

```bash
site2api record https://app.example.com -o out
```

A browser window opens on a dedicated site2api profile (`~/.site2api/profile`), not your everyday
Chrome profile. Log in if the site needs it; the login stays in that profile for next time.

Now use the site the way you want your agent to: search, open a list, open an item. **Do each
thing twice or more**, with different inputs: two searches, two orders. site2api learns which
parts of a request change, what an id looks like, and which fields are optional by comparing
samples.

Press Enter in the terminal (or close the tab) when you are done. site2api saves the recording and
analyzes it right away:

```text
site: example.com
kept 24 requests → 6 REST + 1 GraphQL operations
wrote out/openapi.yaml and out/report.md
```

Open `out/report.md`. It lists every operation found, how it authenticates, and which inputs come
from which responses. If something you used is missing, record again and use it more.

> Already have a HAR from DevTools (Network → right-click → "Save all as HAR with content")? Use
> `site2api from-har capture.har -o out` instead of `record`.

## 2. Name the tools

Operations get heuristic names such as `list_orders` and `get_order`. They are often good enough.
To get better names, descriptions and a read/write classification, pick one:

- **Your coding agent** (no API key): install the skill and ask it to annotate. See
  [Using it from your agent](agents.md).
- **An LLM API**: `site2api infer out` with `ANTHROPIC_API_KEY` set, or any OpenAI-compatible API
  (`SITE2API_LLM_BASE_URL`, `SITE2API_LLM_MODEL`, `SITE2API_LLM_API_KEY`).

Both write `out/annotations.json`. You can also edit it by hand.

## 3. Verify

```bash
SITE2API_COOKIE='<Cookie header>' site2api verify out
```

This calls every read-only operation on the live site and compares the response with the recorded
schema. Write and login operations are never called. Get the cookie from DevTools → Network →
any request to the site → Request Headers → `Cookie`. See [Verify](verify.md) for what the results
mean.

## 4. Generate

```bash
site2api generate out --only-verified
```

```text
6 tools → out/mcp
  · list_orders
  · get_order
  …
register it: out/mcp/mcp.json (setup in out/mcp/README.md)
```

`out/mcp/` holds a self-contained server (`server.mjs`), its tool definitions (`tools.json`), a
ready-to-use `mcp.json`, and a README with setup for each client.

## 5. Register it with your agent

Claude Code:

```bash
claude mcp add app -e SITE2API_COOKIE='<Cookie header>' -- node /path/to/out/mcp/server.mjs
```

Cursor: copy `out/mcp/mcp.json` into `.cursor/mcp.json`. It refers to `${SITE2API_COOKIE}`, which
is read from your environment, so export the cookie before starting Cursor, or replace the
reference with the value in your local config.

Then ask your agent something only the site knows: "What's in my most recent order?"

## All at once

`site2api run <url>` does steps 1–4 in one go: record, annotate (if an LLM key is set), verify
with the session from the recording, and generate with `--only-verified`.

```bash
site2api run https://app.example.com
```

## Next

- No screen? [Capture scripts](capture-scripts.md)
- Sessions expire. When a tool says so, refresh `SITE2API_COOKIE`; no need to regenerate.
- Sites change. Run `site2api verify out` now and then to see what broke.
