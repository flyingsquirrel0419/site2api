# Getting help

- **How do I…?** Start with the [documentation](docs/README.md), especially
  [getting started](docs/getting-started.md) and the [CLI reference](docs/cli.md).
- **A site does not work** (no operations found, inputs wrong, verify fails): open an issue with
  the "Site doesn't work" template. Paste `report.md` and the `verify` output; both are free of
  credential values. **Do not attach the HAR**: it contains your session.
- **A bug in site2api**: open an issue with the bug report template.
- **An idea**: open an issue with the feature request template.
- **A security problem**: follow [SECURITY.md](SECURITY.md), not a public issue.

Issues are answered by volunteers. A minimal reproduction (a few lines of `har()` from
`tests/helpers.ts`) gets the fastest answer.
