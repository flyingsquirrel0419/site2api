---
name: site2api
description: Turn a website the user uses into an MCP server their agent can call. Use when the user wants an API or MCP tools for a site that has no public API, or hands you a HAR file of their own browsing.
---

# site2api

You turn the user's recorded browser traffic into an MCP server. The `site2api` CLI does the
deterministic work (parsing, schemas, auth detection, code generation). Your job is the judgment
in step 4: naming tools, describing them, and deciding which ones are safe to expose.

## Rules

- **Never open, print, or search the HAR file yourself.** It contains the user's cookies and
  passwords. Only the CLI reads it. The same goes for `.site2api/secrets.json`.
- **Never ask the user to paste a cookie or token into the chat.** They put it in their MCP
  client config themselves (step 7).
- **Never write captured values into the chat:** cookies, tokens, API keys, session ids, even
  ones that look public (a search key embedded in the page). Name the environment variable
  instead, e.g. "set `SITE2API_KEY_X_ALGOLIA_API_KEY`".
- **Don't change site2api itself** (its source, `openapi.yaml`, `tools.json`, `server.mjs`).
  The files you write are `annotations.json` and, if needed, a capture script. If site2api gets
  something wrong (an operation misdetected, inputs merged into one, a constant turned into a
  parameter), tell the user what you saw so they can report it, and work around it in the
  annotations where you can.
- Only for the user's own accounts or public pages, and within the site's terms of service. If
  the request is about collecting other people's data at scale, or getting around bot
  protection, stop and say site2api does not do that.
- If you write a capture script: keep it to what the user asked for, call `pause()` between
  steps, and never try to get past a CAPTCHA, a "verify you are human" page, or a block. If you
  hit one, stop and tell the user.

## Shortcut

If the user just wants it done and has an LLM API key configured (`ANTHROPIC_API_KEY`, or
`SITE2API_LLM_BASE_URL` + `SITE2API_LLM_MODEL`), `site2api run <url> -o out` does steps 1–6 in
one go. Use the steps below when there is no key, so that you write the annotations yourself.

## Running the CLI

Use `npx site2api <command>`. If that fails because the package is not published yet and you
are inside the site2api repository, run `pnpm build` once and use `node dist/cli.js <command>`
instead. The steps below write `site2api` for either form.

## Steps

### 1. Capture the traffic

If the user already has a HAR file, use it in step 2. Otherwise record one:

```bash
site2api record <url> -o out
```

A browser window opens on a separate site2api profile. Tell the user: log in if needed, use each
feature they want as a tool two or more times (search, open a list, open an item, …), then
**close the tab** to finish. Your command returns when they do, and it already runs step 2.

If nobody can use a browser window (a server, CI, or the user asked you to do it), write a
capture script instead and run it headless:

```js
// out/capture.mjs: page is a Playwright page already at the start URL
export default async (page, { url, pause }) => {
  await page.fill("input[type=search]", "first query");
  await page.keyboard.press("Enter");
  await pause();
  // …use each feature twice or more, with pause() between steps
};
```

```bash
site2api record <url> --script out/capture.mjs -o out
```

Look at the page first (fetch the HTML, or run a tiny script that prints selectors) instead of
guessing selectors. The recording stops at 60 page loads + API calls (`--max-requests`). If the
script fails partway, what it recorded is still analyzed; fix the script and rerun if a feature
is missing from `report.md`.

To make a HAR without site2api instead: DevTools → Network → check "Preserve log" → use the
site → right-click the request list → "Save all as HAR with content".

Either way, remind them the recording contains their login session and must not be shared or
committed.

### 2. Analyze

```bash
site2api from-har <file.har> -o out
```

(Skip this after `record`, which already did it.) Read `out/report.md`. If it found no operations, or the site is wrong, the recording probably
missed the API calls. Ask the user to record again while using the features, or pass
`--include-origin <api-host>` when the API lives on another domain.

### 3. Read the context

```bash
site2api infer-prompt out
```

Read `out/infer/context.md`. It lists every operation with its inputs, response shape,
authentication, and where its inputs come from. The file format for the next step is in
`out/infer/annotations.schema.json`.

### 4. Write `out/annotations.json`

For each operation, decide:

- `tool`: a snake_case `verb_noun` name an agent would pick, such as `search_products`,
  `get_order`, `list_messages`. Names must be unique.
- `description`: one or two sentences. Say what it returns and when to use it. Mention the
  tool whose results feed an input (the context lists these as "comes from").
- `params`: a short description for each input, using exactly the input names in the context.
- `kind`:
  - `read`: only fetches data.
  - `write`: creates, changes, deletes, sends, buys, or posts anything. When in doubt, choose
    `write`.
  - `auth`: login, logout, refreshing a session, or returning a token. These never become tools.
- `include: false` for noise: telemetry, feature flags, health checks, ads.
- `site`: a human name and a one-sentence description of the site.

Skip anything you cannot judge from the context; the defaults still work.

### 5. Verify

```bash
site2api verify out --profile
```

This calls every read-only operation against the live site and checks the responses. `--profile`
uses the login saved in the record browser profile. If everything that needs a login is
`skipped` (the site uses session cookies, which end with the browser), tell the user they can run
`SITE2API_COOKIE='<Cookie header>' site2api verify out` in their own terminal. Don't run it for
them with a cookie, and don't ask for one. Explain any `fail` results: usually the site changed,
or the schema was built from too few samples.

### 6. Generate

```bash
site2api generate out --only-verified
```

Use `--only-verified` when verify passed the tools the user cares about. Otherwise drop the flag.

If it prints validation errors, fix exactly those fields in `annotations.json` and run it again.
Add `--allow-writes` only if the user explicitly wants tools that change data. Those tools still
require `confirm: true` on every call, and you must get the user's approval for each such call.

### 7. Hand it over

Show the user the tool list that `generate` printed, and point them to `out/mcp/README.md`. It
has the snippet for their client: `.cursor/mcp.json` for Cursor, `claude mcp add` for Claude
Code. Tell them to set the environment variables it lists themselves in that config:
`SITE2API_COOKIE` for a login session (the `Cookie` request header from DevTools → Network), and
`SITE2API_KEY_…` for API keys the site sends in a header or the query string.

Sessions expire. When a tool says the session may have expired, the user refreshes that value.
No regeneration is needed.
