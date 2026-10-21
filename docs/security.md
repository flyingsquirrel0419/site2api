# Security model

site2api handles some of the most sensitive data you have: your logged-in sessions. This is what
it does with them, and what it will not do.

## Where credentials are

| | Contains credentials? |
|---|---|
| The recording (`out/.site2api/capture.har`, or your HAR) | **Yes.** It is your traffic. Keep it local, do not commit or share it. `--discard-har` deletes it after analysis. `.gitignore` excludes `*.har` |
| `openapi.yaml`, `report.md` | No: names of cookies, headers and parameters only |
| `annotations.json`, `infer/context.md`, `verify.json` | No |
| `mcp/tools.json`, `mcp/README.md`, `mcp/mcp.json` | No. `mcp.json` holds `${VAR}` references |
| `.site2api/secrets.json` | Salted SHA-256 hashes of the captured credential values, used by the check below |
| The record browser profile (`~/.site2api/profile`) | Your login on the sites you recorded, like any browser profile |
| The running server | Only in memory, read from its environment |

## The output check

`from-har` collects every value that looks like a credential: cookie and `Set-Cookie` values,
`Authorization` headers, CSRF and API-key headers, query parameters and JSON fields with sensitive
names (password, token, secret, session, key, …). The spec and report are checked against them
directly. For later stages, which no longer have the capture, it stores salted hashes; every file
`generate`, `verify` and `infer` write, and the context `infer` sends to an LLM, is split into
tokens and each token is hashed and compared. A match refuses the write:

```text
site2api: Refusing to write tools.json: it contains 1 value(s) captured as credentials in the HAR.
```

This catches a cookie pasted into an annotation description, or a key that a site echoes in a
response field.

## What leaves your machine

- **Requests to the site itself**: during `record`, `verify` and when the server runs, as you.
- **`infer` only**: `infer/context.md` goes to the LLM you configured. It contains operation names,
  paths, input names and response shapes, not values.

Nothing else. site2api has no telemetry.

## Agents

The skill tells agents to never open the HAR or `secrets.json`, never ask you to paste a cookie or
token, and never write a captured value into the chat. These are instructions to the agent; the
output check above is what site2api enforces itself.

## Writes

Write operations are excluded unless you pass `--allow-writes`. Included ones require
`confirm: true` on every call and are marked destructive for MCP clients. `verify` never calls
them.

## What site2api will not do

- Bypass CAPTCHAs, bot detection, or "verify you are human" pages.
- Hide that it is automation (no stealth plugins), rotate proxies, or spoof fingerprints.
- Crawl or scrape at scale. Capture scripts have a request budget and a minimum pace; the server
  is rate-limited by default.

Use it with your own accounts, for your own data, within each site's terms of service.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a public issue.
