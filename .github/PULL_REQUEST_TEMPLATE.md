## What and why

<!-- What this changes, and the problem it solves. Link the issue: "Fixes #123". -->

## How it was tested

<!-- Tests added or updated, and anything you ran by hand (demo shop, a site of your own). -->

## Type of change

- [ ] Fix
- [ ] New feature
- [ ] Breaking change (a command, flag, env var, file format or generated tool changes incompatibly; see [docs/versioning.md](../docs/versioning.md))
- [ ] Docs or internal only

## Checklist

- [ ] `pnpm typecheck && pnpm test` pass locally
- [ ] Tests cover the change, using synthetic fixtures only (no real recordings)
- [ ] No HAR, cookie, token or key anywhere in the diff
- [ ] Docs updated (`docs/`, `README.md`, `skills/site2api/SKILL.md`) if behavior changed
- [ ] Translated READMEs updated, or noted below that they still need syncing
- [ ] `CHANGELOG.md` has an entry under `Unreleased` (skip for docs or internal-only changes)
