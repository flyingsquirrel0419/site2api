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
  client config themselves (step 6).
- Only for the user's own accounts, and within the site's terms of service. If the request is
  about collecting other people's data at scale, or getting around bot protection, stop and say
  site2api does not do that.

## Running the CLI

Use `npx site2api <command>`. If that fails because the package is not published yet and you
are inside the site2api repository, run `pnpm build` once and use `node dist/cli.js <command>`
instead. The steps below write `site2api` for either form.

## Steps

### 1. Get a HAR file

Ask the user for the path. If they have none, tell them how to record one:

1. Open the site in Chrome and log in.
2. Open DevTools → Network, and check "Preserve log".
3. Use the features they want as tools (search, open a list, open an item, …). Two or more
   examples of each make the result better.
4. Right-click the request list → "Save all as HAR with content".

Remind them the HAR contains their login session and should not be shared or committed.

### 2. Analyze

```bash
site2api from-har <file.har> -o out
```

Read `out/report.md`. If it found no operations, or the site is wrong, the recording probably
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

### 5. Generate

```bash
site2api generate out
```

If it prints validation errors, fix exactly those fields in `annotations.json` and run it again.
Add `--allow-writes` only if the user explicitly wants tools that change data. Those tools still
require `confirm: true` on every call, and you must get the user's approval for each such call.

### 6. Hand it over

Show the user the tool list that `generate` printed, and point them to `out/mcp/README.md`. It
has the snippet for their client: `.cursor/mcp.json` for Cursor, `claude mcp add` for Claude
Code. Tell them to set `SITE2API_COOKIE` themselves in that config. To get the value, they copy
the `Cookie` request header from DevTools → Network on any logged-in request to the site.

Sessions expire. When a tool says the session may have expired, the user refreshes that value.
No regeneration is needed.
