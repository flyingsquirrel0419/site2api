# The generated server

`site2api generate` writes `out/mcp/`:

| File | |
|---|---|
| `server.mjs` | The MCP server (stdio). The MCP SDK is bundled in, so `node server.mjs` is all it needs |
| `tools.json` | Tool definitions and how each maps to HTTP. The server is fixed code that reads this file |
| `mcp.json` | A standard `mcpServers` config, with credentials as `${VAR}` references |
| `README.md` | The tool list with verify results, and setup for each client |
| `package.json` | So the folder can be moved or published as a package |

## Registering it

Claude Code:

```bash
claude mcp add shop -e SITE2API_COOKIE='<Cookie header>' -- node /path/to/out/mcp/server.mjs
```

Cursor: copy `mcp.json` to `.cursor/mcp.json` (project) or merge it into `~/.cursor/mcp.json`.

Other clients: any MCP client that starts a stdio server works. The command is
`node /path/to/out/mcp/server.mjs`, with the environment variables below.

`mcp.json` contains `${SITE2API_COOKIE}`-style references, never values. Clients that expand them
(Claude Code and Cursor do) read them from the environment the client was started in. Otherwise,
put the value in your local copy of the config.

## Environment

| Variable | |
|---|---|
| `SITE2API_COOKIE` | The `Cookie` request header from DevTools → Network, for sites with a login session |
| `SITE2API_BEARER` | A bearer token, for sites that send `Authorization: Bearer …` |
| `SITE2API_KEY_<NAME>` | An API key the site sends in a header or query parameter. `<NAME>` is the header or parameter name in upper snake case, e.g. `x-algolia-api-key` → `SITE2API_KEY_X_ALGOLIA_API_KEY`. The README lists the ones your server needs |
| `SITE2API_BASE_URL` | Call another origin than the recorded one (staging, a local port) |
| `SITE2API_RATE` | Max requests per second (default 1) |
| `SITE2API_MAX_BYTES` | Longest response text returned to the agent (default 20000); longer ones are cut with a note |

The server reads credentials only from its environment and never writes them anywhere.

## What it does for the agent

- **Inputs.** Each tool takes path, query and body inputs as one object. Inputs that had the same
  value in every recorded sample are optional, with that value as the default.
- **Chaining.** Descriptions say where an input comes from, e.g. "use a value from `list_orders`
  results at /orders/*/id".
- **CSRF.** When a call needs a CSRF token, the server fetches it from the operation that provided
  it in the recording, caches it, and refreshes it once on 403.
- **GraphQL.** Each recorded operation is its own tool with a fixed query; the agent passes only
  the variables.
- **Errors.** 401/403 say the session may have expired; a redirect says it probably went to a
  login page; an unreachable site names the host and the reason.

## Writes

Tools that change data (`kind: write`) are left out unless you generate with `--allow-writes`.
Even then, every call must include `confirm: true`, and the tool description tells the agent to
get your approval first. Tools are marked with MCP's `readOnlyHint` / `destructiveHint`
annotations, so clients that support them can ask you too.

## When it stops working

- **"not authorized … may have expired"**: refresh `SITE2API_COOKIE` (or the token). No need to
  regenerate.
- **Wrong or missing data**: run `site2api verify out` to see what changed, then record again and
  regenerate.
