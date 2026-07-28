# Changelog

All notable user-visible changes to `@pragmatic-labs/praxis`.

The format follows [Keep a Changelog](https://keepachangelog.com/), with one
addition: every released version carries an **Upgrading** note stating what the
upgrade asks of you — a prerequisite, a required edit, or explicitly nothing.
Versioning is [semantic](https://semver.org/); while pre-1.0, a minor bump may
carry a breaking change.

Releases before 0.2.0 predate this file and are not recorded here; see the
[decision ledger](docs/wiki/decisions.md) for their history.

## [Unreleased]

### Added

- `changelog` package (`provides: [rules, commands]`) — a standing reminder to
  record user-visible changes plus the `/praxis-changelog` command that writes
  and releases entries in this format. Opt-in: a repo that ships no releases has
  nothing to record.
- `/praxis-upgrade` command (in the `upkeep` package) — upgrades Praxis itself
  by moving the CLI pin and `praxis.yaml`'s `methodology:` pin together, in the
  right order, after reading the target version's **Upgrading** note.
- `CHANGELOG.md` now ships in the published npm package, so an upgrade's
  **Upgrading** note is readable from `node_modules` without visiting GitHub.

### Changed

- The `upkeep` rule now also asks the agent to check for a newer Praxis release
  at the start of work, and to offer `/praxis-upgrade` when one exists. It never
  upgrades unprompted and skips silently when the registry is unreachable.
- Consumer-CI documentation now covers **non-Node projects**: Python and other
  repos pin the CLI with `npm exec --yes --package=@pragmatic-labs/praxis@<version>`
  instead of adding a `package.json`, a lockfile, or committed `node_modules`.

## [0.2.0] - 2026-07-23

Methodology-pin hardening. `praxis.yaml`'s `methodology:` value stops being an
inert recorded string and becomes an enforced pin.

### Added

- Interactive `praxis sync` offers to bump a stale `methodology:` pin: when the
  running CLI is newer than the pinned version, it prompts to update
  `praxis.yaml` and apply in one step. The edit is targeted — comments, field
  order, and quoting are preserved. `praxis check`, `sync --yes`, and any
  non-interactive terminal never prompt and keep failing loud.
- Documentation for a reproducible CLI pin in CI: an exact `devDependency`, a
  committed lockfile, `npm ci`, and invocation through `node_modules/.bin` —
  never a bare `npx`, which resolves through a cache and can silently run a
  different release on a re-run.

### Changed

- **`methodology:` is now resolved and enforced against the running Praxis
  version**, exact-match while pre-1.0, and fails loud in **both** directions:
  a pin newer than the running CLI, or unparseable, errors; a pin older than
  the running CLI reports that an upgrade is available. Both messages name the
  two versions and the remedy.
- `praxis init` stamps the running CLI's own version into `praxis.yaml` at
  scaffold time, replacing a fixed constant that had drifted 18 minor versions
  behind the shipped release.
- `praxis sync` writes through a plan → stage → verify → commit boundary
  spanning all five of its passes. Every write is staged and hash-verified
  before any destination is touched, so a failure **before** commit leaves the
  repository byte-identical; a failure during commit converges on a re-run.
  Emitted bytes are unchanged — only *when* they land changed.
- `sync` refuses to overwrite a destination that changed on disk between plan
  and commit, in both directions (a file that existed must keep its hash; one
  that was absent must stay absent), reporting an `external-change` conflict
  instead of clobbering.

### Fixed

- Incomplete string escaping in a path-handling routine (CodeQL finding).

### Upgrading

**This release is breaking for any repository whose `praxis.yaml` pins a
methodology other than `0.2.0`.** Previously the value was recorded and never
checked, so stale pins were invisible; they now fail `praxis check` with a
non-zero exit.

To upgrade, move both pins to `0.2.0` together:

1. Install `@pragmatic-labs/praxis@0.2.0` wherever your project pins the CLI.
2. Set `methodology: "0.2.0"` in `praxis.yaml` — or run `praxis sync` in an
   interactive terminal and accept the bump prompt, which does both the edit and
   the re-emit in one transaction.
3. Run `praxis sync`, then `praxis check`.

A pin-only upgrade is common and safe: if no emitted file changes, the version
string was the only thing out of date. Node `>=22.12.0` remains the floor,
unchanged since 0.1.17.
