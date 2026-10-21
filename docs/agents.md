# Using it from your agent

site2api does the deterministic work: parsing traffic, schemas, auth, dependencies, code
generation. One step needs judgment: naming tools, describing them, and deciding which operations
are reads, writes or logins. Your coding agent can do that step, or an LLM API can.

## With the skill (no API key)

[`skills/site2api/SKILL.md`](../skills/site2api/SKILL.md) is an [Agent Skill](https://agentskills.io).
Copy the `skills/site2api` folder to where your agent looks for skills:

| Agent | Location |
|---|---|
| Claude Code | `.claude/skills/` (project) or `~/.claude/skills/` |
| Cursor | `.agents/skills/` or `.cursor/skills/` (also reads `.claude/skills/`) |
| Codex | `.agents/skills/` or `.codex/skills/` |

Then ask in plain words:

> Make an MCP server for https://app.example.com. I want search, my orders, and order details.

The skill has the agent:

1. record the site (you use the browser window; or, with no one at the screen, it writes a
   [capture script](capture-scripts.md)),
2. read `out/report.md` and `out/infer/context.md`,
3. write `out/annotations.json`,
4. run `verify` and `generate`, fixing annotation errors if `generate` reports any,
5. tell you how to register the server and which environment variables to set.

It follows these rules:

- never open the HAR or `secrets.json` itself; only the CLI reads them,
- never ask you to paste a cookie or token into the chat, and never write a captured value into
  the chat (it names the environment variable instead),
- never change site2api itself; if site2api gets something wrong, it tells you,
- never use `--allow-writes` unless you asked for tools that change data,
- stop at CAPTCHAs and blocks.

The skill uses only shell commands and file edits, so it works the same in any agent. It has
been tested end to end with Cursor's agent on Grok.

## With an LLM API

```bash
ANTHROPIC_API_KEY=… site2api infer out
```

| Provider | Configuration |
|---|---|
| Claude (`--provider anthropic`) | `ANTHROPIC_API_KEY`. Default model `claude-opus-5-5`, `--model` to change. Uses structured output and server-side refusal fallback |
| OpenAI-compatible (`--provider openai`) | `SITE2API_LLM_BASE_URL` (e.g. `https://api.x.ai/v1`, OpenRouter, a local Ollama), `SITE2API_LLM_MODEL`, `SITE2API_LLM_API_KEY`. Uses strict `json_schema` output, falling back to `json_object` for servers without it |

Without `--provider`, site2api picks whichever is configured. Only `infer/context.md` is sent: a
summary of operations, inputs and response shapes, with no cookies, tokens or response values. It
is checked against the capture's credential hashes before it is sent.

The answer is validated exactly like `generate` validates `annotations.json`; errors go back to
the model for up to 3 attempts. An existing `annotations.json` is kept unless you pass `--force`.

## annotations.json

Whoever writes it, the format is the same (`out/infer/annotations.schema.json`):

```json
{
  "version": 1,
  "site": { "name": "Demo Shop", "description": "A small online store." },
  "operations": {
    "list_products": {
      "tool": "search_products",
      "title": "Search products",
      "description": "Search the catalog by name. Product ids feed get_product.",
      "params": { "q": "Search text" },
      "kind": "read"
    },
    "post_login": { "kind": "auth" },
    "get_isalive": { "include": false }
  }
}
```

| Field | |
|---|---|
| `tool` | snake_case `verb_noun`, unique |
| `description` | What it returns or does, when to use it, where its inputs come from |
| `params` | One description per input, using the input names from `context.md` |
| `kind` | `read`, `write` (creates, changes, deletes, sends, buys) or `auth` (never exposed). `read` is refused for operations that can change data (PUT, PATCH, DELETE, GraphQL mutations, most POSTs) |
| `include` | `false` drops noise: telemetry, feature flags, health checks |

Anything left out keeps its default. Operations that hand out credentials (login, the CSRF token
source) default to `auth`, so their tokens never reach the agent.
