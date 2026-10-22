<p align="center">
  <b>English</b> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a>
</p>

<h1 align="center">site2api</h1>

<p align="center"><b>Turn the web apps you use into MCP tools your agent can call.</b><br>
Record a few actions, generate a local MCP server, and check its read tools against the live site.</p>

<p align="center">
  <a href="https://github.com/flyingsquirrel0419/site2api/actions/workflows/ci.yml"><img src="https://github.com/flyingsquirrel0419/site2api/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6d4aff" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522.12-339933?logo=node.js&logoColor=white" alt="Node 22.12+">
  <img src="https://img.shields.io/badge/MCP-server-1c2030" alt="MCP">
  <img src="https://img.shields.io/badge/Agent%20Skills-Claude%20Code%20%C2%B7%20Cursor%20%C2%B7%20Codex-1c2030" alt="Agent Skills">
</p>

<p align="center">
  <img src="docs/assets/demo.gif" alt="A recorded web app becomes three MCP tools connected to an agent" width="860">
  <br><sub>From browser requests to callable tools. <a href="docs/assets/demo.mp4">Watch the HD video</a>.</sub>
</p>

## Why site2api

Many web apps have no public API for the actions you need, even though their own frontends make JSON or GraphQL requests. An agent can navigate the UI repeatedly, but that makes each task depend on browser interaction.

site2api records those requests while you use the app. It identifies operations, infers input schemas and where values such as item IDs come from, then generates a local MCP server. Before generation, it calls eligible read operations against the live site and reports which responses match the recording.

**Best fit:** Web apps that use JSON or GraphQL APIs, including dashboards, internal tools you are authorized to use, and search interfaces. HTML-only sites and sites that block ordinary browser access are not a fit.

## Quick start

Requires Node.js 22.12+ and an installed Chrome browser. If Chrome is unavailable, install Playwright Chromium once with `npx playwright install chromium`.

```bash
npx site2api run https://app.example.com
```

A dedicated browser profile opens. Sign in if needed, use each feature you want as a tool at least twice with different inputs, then press Enter. The command records, analyzes, verifies read operations, and writes a self-contained server to `out/mcp/`. If no LLM provider is configured, it uses heuristic tool names; you can refine them later.

```text
out/
├── report.md       # operations and input relationships
├── verify.json     # pass, warning, failure, error, or skip for each read operation
└── mcp/
    ├── server.mjs  # bundled MCP server
    ├── tools.json  # tool definitions
    └── mcp.json    # client configuration
```

Register the server with an MCP client. For example, with Claude Code:

```bash
claude mcp add app -e SITE2API_COOKIE='<Cookie header>' -- node /absolute/path/to/out/mcp/server.mjs
```

Set only the credentials your generated `out/mcp/README.md` lists. For other clients, see [the generated server guide](docs/generated-server.md). To record without a screen, use a [capture script](docs/capture-scripts.md); you can also import a HAR from DevTools.

### Use it with a coding agent

Copy [`skills/site2api`](skills/site2api) into your project's `.claude/skills/` or `.agents/skills/` directory, then ask:

> Make an MCP server for https://app.example.com. I need search, my orders, and order details.

The skill guides the agent through recording, naming, verification, and generation. It uses your existing coding agent, so this path needs no separate LLM API key. See [Using it from your agent](docs/agents.md).

## What the server provides

| Capability | How it works |
|---|---|
| **Useful inputs** | Values unchanged across recorded samples become defaults instead of required arguments. |
| **Tool chaining** | Descriptions identify where inputs come from, such as an `orderId` in `list_orders` results. |
| **Authentication** | The server reads session cookies, bearer tokens, and API keys from environment variables; it can fetch and refresh recorded CSRF tokens. |
| **Controlled writes** | Write tools are excluded by default. With `--allow-writes`, each call still requires `confirm: true`. |
| **Local output** | `server.mjs` bundles the MCP SDK and runs with Node.js without installing dependencies in `out/mcp/`. |

The capture, analysis, verification, and generation stages are described in [How it works](docs/how-it-works.md).

## Verify before you connect

```text
✅ list_orders      HTTP 200
🟡 search_stories   HTTP 200, but missing: /processingTimingsMS/fetch/total
❌ get_product      /price: expected number, got string
⚠️ get_profile      not authorized: credentials missing or expired
⏭  get_invoice      needs input: invoiceId
```

`site2api verify out` calls read operations against the live site and compares their responses with the recorded schemas. A **pass** matches; a **warning** means types match but fields seen in every recorded sample are missing; a **failure** indicates an unexpected status or schema mismatch; an **error** indicates a request failure, HTTP 401/403 response, or redirect; a **skip** needs an input or credential. Write and login operations are never called by `verify`. `generate --only-verified` includes passing and warning read tools. See [Verify](docs/verify.md).

## Security and scope

Use site2api with accounts and data you are authorized to access, within the site's terms.

- **Keep the raw recording private.** The HAR can contain session credentials. It stays in a user-only local directory unless you choose `--discard-har`; do not commit or share it.
- **Generated files exclude captured credential values.** Specs, reports, annotations, verification results, and server files are checked against fingerprints of captured credentials before they are written. The running server reads credentials from its environment.
- **Writes are opt-in.** `verify` never invokes write operations, and generated write tools require `confirm: true` on every call.
- **No bypass or bulk crawling.** site2api does not bypass CAPTCHAs or bot protection, use stealth plugins or proxy rotation, or aim to scrape at scale.

The optional `infer` command sends operation names and shapes—not recorded values—to the configured LLM provider. site2api has no telemetry. Read the [security model](docs/security.md) for the exact data flow and limits.

## FAQ

**Does it need an LLM API key?** No for `run` with heuristic names or the Agent Skill with your existing coding agent. The optional `infer` command needs a configured provider.

**What if my session expires?** Refresh the credential in the server's environment; you do not need to regenerate the server.

**What if the site changes?** Run `site2api verify out` to identify affected tools, then record again and regenerate if needed.

**Which clients work?** Any MCP client that can start a stdio server, including Claude Code, Cursor, Codex, and Claude Desktop. See [client setup](docs/generated-server.md).

## Documentation

[Getting started](docs/getting-started.md) ·
[CLI reference](docs/cli.md) ·
[Capture scripts](docs/capture-scripts.md) ·
[Using it from your agent](docs/agents.md) ·
[Verify](docs/verify.md) ·
[Generated server](docs/generated-server.md) ·
[How it works](docs/how-it-works.md) ·
[Security model](docs/security.md)

## Development

```bash
pnpm install
pnpm test
pnpm demo
pnpm build && node dist/cli.js run http://localhost:4317 --script demo/shop/capture.mjs
```

The demo animation is a [HyperFrames](https://github.com/heygen-com/hyperframes) project in `demo/motion/`. Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md).

## License

MIT
