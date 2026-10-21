# Versioning

site2api follows [Semantic Versioning](https://semver.org/). This page says what counts as a
breaking change for site2api, which part of the version each kind of change bumps, and how a
release is cut.

## What is covered

site2api is a command-line tool with no programmatic API: the package exports nothing, and
importing its modules is not supported. The compatibility promise covers what users and agents
rely on:

| Interface | Examples |
|---|---|
| Commands and flags | `run`, `record`, `from-har`, `verify --only-verified`, `generate -o` |
| Exit codes | `0` success, `1` error, `2` invalid `annotations.json` |
| Environment variables | `SITE2API_COOKIE`, `SITE2API_BEARER`, `SITE2API_KEY_<NAME>`, `SITE2API_BASE_URL`, `SITE2API_RATE`, `SITE2API_MAX_BYTES`, `SITE2API_TOOLS`, `SITE2API_PROFILE_DIR`, `SITE2API_LLM_*` |
| Files people or agents edit, or other programs read | `annotations.json`, `tools.json`, `verify.json`, `mcp.json`, and the structure of `openapi.yaml` |
| The generated MCP server | tool names and inputs for the same recording and annotations, `confirm: true` on writes, the env vars it reads |
| The Agent Skill | the commands and files `skills/site2api/SKILL.md` tells an agent to use |
| Requirements | the minimum Node.js version, and `playwright` being optional |

Not covered, and free to change in any release: the wording of `report.md`, `infer/context.md`,
terminal output and generated READMEs; which requests count as noise; the order of operations in
the spec; anything under `out/.site2api/`; internal modules.

Better inference is not a breaking change in itself. A release may find operations, links or
schema fields it missed before. If it would **rename** the tools an existing recording produces,
that is breaking.

## Which number to bump

### Before 1.0 (now)

Versions are `0.MINOR.PATCH`. Anything may change, but never silently:

| Change | Bump | Example |
|---|---|---|
| Breaking: anything in the table above changes incompatibly | **minor** | a flag is renamed, `tools.json` gets a required field, Node 24 becomes the minimum |
| New feature | **minor** | a new command, flag, auth type or LLM provider |
| Fix, security fix, docs, internal change, or a dependency update that changes nothing above | **patch** | a GraphQL operation was split wrongly, a credential reached `report.md` |

A breaking change is listed under **Changed** in the changelog, starting with **Breaking:**, and
says what users must do.

### From 1.0

Standard SemVer: **major** for breaking changes, **minor** for features, **patch** for fixes.
1.0 ships once the file formats in the table above have gone a few releases without change.

### File format versions

`annotations.json`, `tools.json` and `verify.json` carry their own `"version": 1`. Bump that
number only when a file written by an older site2api can no longer be read as before. The same
release must either read the old format or reject it with a message that says how to regenerate
it, and it is a breaking release.

### Pre-releases

Use `x.y.z-beta.N` (or `-rc.N`) to try a release before it becomes `latest`. Pre-releases go to
the npm dist-tag `next`, so `npm install site2api` never picks one up.
`npm install site2api@next` does.

### Never

- Never publish the same version twice, or reuse one that was unpublished: npm refuses both.
  Fix forward with a new patch release.
- Never publish a stable version lower than the current `latest`.

## Cutting a release

1. Pick the version with the tables above.
2. Set `version` in `package.json`.
3. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`, add an empty
   `## [Unreleased]` above it, and update the links at the bottom. Group entries under **Added**,
   **Changed**, **Deprecated**, **Removed**, **Fixed** and **Security**.
4. Run `pnpm release:check vx.y.z`. It runs the same checks as the release workflow.
5. Commit on `main` ("Release x.y.z"), then tag and push:

   ```bash
   git tag vx.y.z && git push origin main vx.y.z
   ```

The [release workflow](../.github/workflows/release.yml) tests the tag and publishes it to npm
with provenance. It stops before publishing if anything is off (see
[CONTRIBUTING](../CONTRIBUTING.md#releasing-maintainers)). If it fails after the tag is pushed,
fix the cause and re-run the workflow. If the fix needs a new commit, delete the tag and tag the
new commit, unless the version already reached npm. In that case, release the next patch
version instead.

The first release is `0.1.0`. It also registers the `site2api` name on npm.
