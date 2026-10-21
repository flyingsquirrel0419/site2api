# Changelog

All notable changes to site2api are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Before 1.0, a minor version may break things and
says how under **Changed**. [Versioning](docs/versioning.md) has the details.

## [Unreleased]

The first public version.

### Added

- `site2api run <url>`: record, analyze, infer, verify and generate in one command.
- `record`: a real browser with a dedicated profile (`~/.site2api/profile`), or headless with a
  capture script (`--script`). A request budget and pauses keep it at human pace.
- `from-har`: filters noise, templates paths, infers request and response schemas, splits GraphQL
  operations, detects cookie, bearer and API key auth, and traces which response values feed
  later requests. Writes `openapi.yaml` (OpenAPI 3.1) and `report.md`.
- `infer-prompt` and `infer`: names and describes tools with your agent (the Agent Skill) or with
  Claude or any OpenAI-compatible model, validating the result and retrying on errors.
- `verify`: calls every read tool against the live site and checks responses against the
  inferred schema (`pass`, `warn`, `fail`, `skipped`, `error`). Never calls write operations.
- `generate`: `tools.json`, a self-contained MCP server (`server.mjs`), `mcp.json` with
  `${VAR}` credential references, and a README. Write tools require `confirm: true`.
- A credential gate: every output is checked against fingerprints of the captured credentials,
  and the run stops if one would leak.
- The `site2api` Agent Skill, documentation, a demo shop, and README translations
  (한국어, 日本語, 简体中文, Español).

### Security

- Credentials with short or generic names (`pwd`, `pw`, `sig`, `access_key`, `code`, `key`),
  fields under a sensitive parent, form-encoded login bodies, and string literals in GraphQL
  queries no longer reach `openapi.yaml`, `report.md` or the LLM context; the leak check also
  looks inside URLs and decoded values.
- The session cookie and token are only sent to the recorded site. Profile cookies are chosen per
  host as a browser would, so shared-hosting neighbours (`*.github.io`, `*.vercel.app`, …) never
  get each other's.
- Path inputs can no longer be `.` or `..`, and annotations cannot mark data-changing operations
  `read` (which would skip `confirm` and let `verify` call them).
- Requests time out after 30 s and responses are read up to 10 MB.
- `out/.site2api/` and the browser profile are private to your user; `--discard-har` also
  deletes the recording when analysis fails.
- The skill tells agents to treat site content as data, never as instructions.

[Unreleased]: https://github.com/flyingsquirrel0419/site2api/commits/main
