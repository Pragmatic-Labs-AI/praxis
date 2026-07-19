# fresh-app

Minimal fixture for Praxis first-run dogfooding.

## Purpose

This directory is INPUT DATA for automated tests and the manual dogfood ritual:

- **Automated:** `conformance/onboarding-fixture.conformance.test.ts` copies this
  directory into a tmpdir, runs `applyInit`, and asserts the deterministic
  first-run surface (sentinel written + composed onboard command present + no
  post-init drift).
- **Manual:** maintainers copy this out of the repo, run `npx @pragmatic-labs/praxis
  init`, open in Claude Code, and run `/praxis-onboard` to exercise the live
  agent flow (see `docs/wiki/onboarding.md` for the full ritual).

**Do not run `praxis init` against this directory in place.** It would write
`praxis.yaml`, `.claude/`, and the sentinel into the checked-in fixture.
Always copy it to a temporary directory first.
