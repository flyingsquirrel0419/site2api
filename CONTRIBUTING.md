# Contributing to site2api

Thanks for helping. This guide covers how to set up the project, where things live, how to test a
change, and what a pull request needs.

By taking part you agree to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Bug or broken site?** Open an issue with the template. Describe what you recorded and what
  went wrong, and paste `report.md`. **Never attach a HAR file, a cookie, a token or an API key.**
  A HAR is a recording of your logged-in session.
- **New feature?** Open an issue first, so we can agree on the shape before you write it.
- **Security problem?** Do not open a public issue. See [SECURITY.md](SECURITY.md).

### What we will not merge

site2api is for a person's own accounts and data, used at a human pace. Pull requests that add any
of the following will be closed, however well made:

- getting past CAPTCHAs, bot detection, or "verify you are human" pages; stealth or fingerprint
  spoofing; proxy rotation;
- crawling or bulk scraping, or raising the request budget and pacing limits by default;
- storing credential values (cookies, tokens, keys) anywhere in the outputs.

See [the security model](docs/security.md) for the reasoning.

## Setup

You need Node.js 22.12+ and pnpm (the version is pinned in `package.json`; `corepack enable`
picks it up).

```bash
git clone https://github.com/flyingsquirrel0419/site2api && cd site2api
pnpm install
pnpm exec playwright install chromium   # for the record tests
pnpm test
```

Useful commands:

| Command | |
|---|---|
| `pnpm test` | Unit tests plus MCP, verify and record end to end against the demo shop. Builds first |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build` | `dist/cli.js` and the bundled MCP runtime `dist/runtime/server.mjs` |
| `pnpm demo` | The demo shop on http://localhost:4317 |
| `pnpm record-fixture` | Re-record `tests/fixtures/demo-shop.har` from the demo shop |
| `node dist/cli.js run http://localhost:4317 --script demo/shop/capture.mjs` | The whole pipeline, headless |

CI runs the same steps on Node 22 and 24 (`.github/workflows/ci.yml`).

## Where things live

```text
src/
├── capture/      HAR parsing, record (Playwright), capture scripts
├── normalize/    filter, path templates, schemas, GraphQL, auth shape, dependency tracing (links)
├── spec/         operations → OpenAPI 3.1, and the catalog read back from it
├── infer/        context.md, annotations.json validation, LLM providers (Claude, OpenAI-compatible)
├── verify/       live verification of read tools
├── generate/     tools.json, mcp.json, the generated README
├── runtime/      the MCP server and its HTTP client (shared with verify)
├── redact.ts     credential collection and the output gate
└── cli.ts        commands
skills/site2api/  the Agent Skill
demo/shop/        the local demo shop and its capture script
demo/motion/      the README video (HyperFrames project)
docs/             user documentation
tests/            vitest suites, fixtures and golden snapshots
```

[How it works](docs/how-it-works.md) explains each stage.

## Making a change

- **Tests come with the change.** Most bugs reproduce with a few lines of `har()` from
  `tests/helpers.ts`, as in `tests/realworld.test.ts`. A fix for a behavior seen on a real site
  should get a synthetic test shaped like that site, never a real recording.
- **Fixtures are synthetic.** Only HARs recorded from the demo shop, or written by hand, go into
  `tests/fixtures/`. Do not commit real traffic, even your own.
- **Golden snapshots** live in `tests/__snapshots__/`. If your change alters the generated spec,
  report, context or tools on purpose, update them with `pnpm vitest run -u` and check the diff.
- **Credentials never leave the capture.** Any new output file must pass through
  `assertNoSecrets` or `assertNoFingerprintedSecrets` (`src/redact.ts`), and a test should show
  that a captured value cannot reach it.
- **Match the surrounding code.** TypeScript, ES modules, no new dependencies without a reason.
  Comments say why, not what.

### Documentation and translations

- User-facing behavior changes update `docs/` and, when it shows there, `README.md`.
- The README exists in five languages (`README.md`, `README.ko.md`, `README.ja.md`,
  `README.zh-CN.md`, `README.es.md`). If you change the English README and cannot update the
  others, say so in the pull request; a maintainer will sync them. Code blocks and links must stay
  identical across all five.
- A change to how the agent should work updates `skills/site2api/SKILL.md`. It has to work in any
  agent, so it uses only shell commands and file edits. [docs/testing-skill.md](docs/testing-skill.md)
  describes how to test it in another agent.

### Commits

Write the subject in the imperative, under about 70 characters ("Treat POSTs to lookup paths as
reads"), and use the body to explain why, with the user-visible effect. One logical change per
commit.

## Pull requests

1. Fork, branch from `main`, and keep the change focused.
2. Run `pnpm typecheck && pnpm test` locally.
3. Fill in the pull request template: what changed, why, and how you tested it.
4. CI must pass. A maintainer reviews; expect questions and small requests.

By contributing, you agree that your contribution is licensed under the project's
[MIT license](LICENSE).
