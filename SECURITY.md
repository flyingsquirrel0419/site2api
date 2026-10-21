# Security policy

site2api handles recorded browser traffic, which contains people's sessions. We take reports
seriously and would rather hear about a possible problem early.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through GitHub:
**Security → Report a vulnerability** on
[the repository](https://github.com/flyingsquirrel0419/site2api/security/advisories/new).

Include what you found, how to reproduce it (a synthetic HAR built like `tests/helpers.ts` is
ideal), and the impact you expect. **Do not send real HAR files, cookies, tokens or keys**, yours or
anyone else's.

What to expect:

- an acknowledgement within 3 days,
- an assessment and a plan within 10 days,
- a fix and a published advisory crediting you (unless you prefer not to be named).

## What counts

Highest priority — anything that lets a credential captured in a recording end up somewhere it
should not:

- a cookie, token, API key or password value appearing in `openapi.yaml`, `report.md`,
  `annotations.json`, `infer/context.md`, `verify.json`, `tools.json`, `mcp.json`, the generated
  README, or the context sent to an LLM by `site2api infer`;
- a way around the output check (`src/redact.ts`);
- the generated MCP server sending a credential to a host other than the one it was recorded for,
  or writing it to disk.

Also in scope:

- the generated server calling a write operation without `confirm: true`, or `verify` calling one
  at all;
- code execution through a crafted HAR, spec, annotations file or capture script beyond what
  running that script already implies.

Out of scope: a capture script you wrote doing what you told it to; issues in a site that
site2api records; denial of service against your own machine through a huge HAR.

## Supported versions

site2api is pre-1.0. Security fixes go into `main` and the latest release.

See [docs/security.md](docs/security.md) for how site2api handles credentials.
