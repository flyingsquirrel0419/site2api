# CLI reference

Every command writes into, or reads from, one output directory (`out` by default):

```text
out/
├── openapi.yaml          the spec (OpenAPI 3.1 + x-site2api extensions)
├── report.md             what was found, how it authenticates, where inputs come from
├── annotations.json      tool names, descriptions, kinds (written by you, your agent or `infer`)
├── verify.json           results of `verify`
├── infer/                context.md and annotations.schema.json, from `infer-prompt`
├── mcp/                  server.mjs, tools.json, mcp.json, README.md, from `generate`
└── .site2api/            secrets.json (salted hashes only), source.json, capture.har (from `record`)
```

## `run <url>`

Record → analyze → annotate (when an LLM is configured) → verify → generate, in one go. Verify uses
the session cookies captured at the end of the recording, in memory only.

| Option | |
|---|---|
| `-o, --out <dir>` | Output directory (default `out`) |
| `--script <file>` | Drive the site with a [capture script](capture-scripts.md) instead of by hand; runs headless |
| `--headed` | Show the browser window while a script runs |
| `--max-requests <n>` | Stop a script after this many page loads + API calls (default 60) |
| `--include-origin <host...>` | Extra hosts or sites to keep (an API on another domain) |
| `--profile-dir <dir>` | Browser profile (default `~/.site2api/profile`) |
| `--provider <name>` | `anthropic` or `openai` for annotation; inferred from env, skipped if none |
| `--model <id>` | LLM model id |
| `--allow-writes` | Include tools that change data (they still require `confirm: true`) |
| `--name <name>` | Server name (default: from annotations, else the recorded host) |
| `--discard-har` | Delete the recording after analysis |

## `record <url>`

Open a browser, record while the site is used, then analyze the traffic (same output as
`from-har`). Ends on Enter in the terminal, when the last tab closes, when a script returns, or at
the request limit. Takes `-o`, `--script`, `--headed`, `--max-requests`, `--include-origin`,
`--profile-dir` and `--discard-har` as above.

The recording is kept at `out/.site2api/capture.har`. It contains your session; do not share or
commit it.

## `from-har <file>`

Analyze a HAR exported from DevTools or Playwright.

| Option | |
|---|---|
| `-o, --out <dir>` | Output directory (default `out`) |
| `--site <site>` | First-party site (eTLD+1); inferred from the most frequent API host when omitted |
| `--include-origin <host...>` | Extra hosts or sites to keep |
| `--examples` | Include redacted example values in the spec |

## `infer-prompt [dir]`

Write `infer/context.md`, a value-free summary of the spec for an agent to read, and
`infer/annotations.schema.json`, the format of `annotations.json`. Used by the skill.

## `infer [dir]`

Annotate with an LLM API instead of a coding agent. Sends only `context.md`; validates the answer
and feeds errors back for up to 3 attempts. See [Using it from your agent](agents.md).

| Option | |
|---|---|
| `--provider <name>` | `anthropic` (Claude) or `openai` (any OpenAI-compatible API); inferred from env |
| `--model <id>` | Default `claude-opus-5-5` for anthropic; `SITE2API_LLM_MODEL` for openai |
| `--force` | Overwrite an existing `annotations.json` |

## `verify [dir]`

Call every read-only operation on the live site and check responses against the spec. See
[Verify](verify.md).

| Option | |
|---|---|
| `--base-url <url>` | Call this origin instead of the recorded one |
| `--input <op.name=value...>` | Value for a required input, e.g. `get_product.productId=2` |
| `--har <file>` | Capture to replay input values from (default: the one `from-har` or `record` used) |
| `--rate <n>` | Max requests per second (default 1) |
| `--profile` | Use the persistent cookies of the record browser profile |
| `--profile-dir <dir>` | Browser profile for `--profile` |

Credentials come from `SITE2API_COOKIE`, `SITE2API_BEARER` and `SITE2API_KEY_<NAME>`; API keys not
in the environment are taken from the recording, in memory.

## `generate [dir]`

Generate the MCP server in `<dir>/mcp`.

| Option | |
|---|---|
| `--allow-writes` | Include tools that change data (they still require `confirm: true`) |
| `--only-verified` | Keep only read tools that passed `verify` (🟡 warnings count as passing) |
| `--name <name>` | Server name |

Exit code 2 means `annotations.json` is invalid; the errors name each field to fix.

## Environment

| Variable | Used by | |
|---|---|---|
| `SITE2API_COOKIE` | verify, server | Cookie header for a login session |
| `SITE2API_BEARER` | verify, server | Bearer token |
| `SITE2API_KEY_<NAME>` | verify, server | API key sent in a header or query parameter, e.g. `SITE2API_KEY_X_API_KEY` |
| `SITE2API_BASE_URL` | server | Replace the recorded origin |
| `SITE2API_RATE` | server | Max requests per second (default 1) |
| `SITE2API_MAX_BYTES` | server | Response text limit per call (default 20000) |
| `SITE2API_PROFILE_DIR` | record, verify | Default browser profile |
| `ANTHROPIC_API_KEY` | infer | Claude |
| `SITE2API_LLM_BASE_URL`, `SITE2API_LLM_MODEL`, `SITE2API_LLM_API_KEY` | infer | OpenAI-compatible API |
