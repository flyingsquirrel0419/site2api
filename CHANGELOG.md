# Changelog

All notable changes to site2api are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/): a breaking change bumps the major version and says
how under **Changed**. [Versioning](docs/versioning.md) has the details.

## [Unreleased]

### Security

- A POST whose path looks like a lookup (`/search`, `/query`, `/find`, …) stays a write until
  `annotations.json` sets `kind` to `read`. `verify` no longer calls it on its own, and
  `generate` no longer exposes it without `--allow-writes`. Set `kind` to `read` when that POST
  only fetches data.
- `verify --rate` must be a finite number >= 0. A typo no longer turns the limit off. `0` still
  means no limit. The server's `SITE2API_RATE` already ignored bad values.
- `record` without `--script` exits when stdin is not a terminal, instead of waiting forever.
- `verify` stops when the capture cannot be read, instead of calling the site without recorded
  inputs.
- `record` still asks Playwright to flush the HAR after the browser closes itself, and waits
  briefly for the file.
- Path inputs reject `/`, `\`, `..`, and `%2e` / `%2f`, so one parameter cannot retarget the URL.
- Credential values of 4 or 5 characters are tracked when they contain a digit or mixed case
  (`abc12`). Plain words that short (`dark`, `true`) are still ignored.
- `generate`, `verify`, and `infer` refuse to run without `.site2api/secrets.json`.
  `generate --unsafe-no-fingerprint` is the explicit bypass.
- The generated server only reads the `tools.json` next to `server.mjs`. `SITE2API_TOOLS` cannot
  point at another file.

## [1.0.0] - 2026-10-22

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

[Unreleased]: https://github.com/flyingsquirrel0419/site2api/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/flyingsquirrel0419/site2api/releases/tag/v1.0.0
