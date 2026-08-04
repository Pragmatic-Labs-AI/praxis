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

### Fixed

- **The upkeep and upgrade workflows contradicted each other on CLI version.**
  `/praxis-upkeep` told agents to fall back to
  `npx @pragmatic-labs/praxis@latest`, while `/praxis-upgrade` requires
  `methodology:` to equal the running CLI exactly. On a repo pinned to an older
  release, that fallback fetches a CLI which `check` and `sync` then refuse —
  so routine upkeep breaks the moment a newer version ships. Emitted
  methodology now names the pinned invocation
  (`npx @pragmatic-labs/praxis@<your methodology version>`), substituted at emit
  time. Four files carried the floating tag, including `allowed-tools`
  frontmatter that a consumer repo could not have corrected locally.

  Nothing was ever silently upgraded: the version guard added in 0.2.0 already
  refuses a CLI/pin mismatch in both directions and writes nothing. The bug was
  a broken maintenance path, not a silent methodology change.
- **The emitted rules never named the package**, so on a machine without the
  binary an agent had no way to get from "run `praxis check`" to a command that
  runs — bare `praxis` is `command not found`, and `npx --no-install praxis`
  reports npm's unhelpful "could not determine executable to run". The
  always-loaded upkeep rule now carries the resolvable, pinned invocation.
- `/praxis-workspace-upkeep` now states that **a member repo pins its own
  `methodology:`, which may differ from the hub's**, and that commands run
  inside a member must use that member's version. Previously it directed every
  repo in the workspace at one floating tag.

### Upgrading

Run `praxis sync`. Your emitted `.claude/rules/praxis-upkeep.md`,
`.claude/commands/praxis-*.md`, Codex skills, and `AGENTS.md` blocks pick up the
pinned invocation in place of `@latest`; no manual edit is required.

The pinned version is written into `allowed-tools` frontmatter, so after a
future version bump the permission entry names the new version. If you have
copied any of these commands into your own repo-local overrides, re-pin them by
hand — `sync` only rewrites what Praxis owns.

## [0.3.0] - 2026-07-28

Release communication becomes part of the methodology Praxis ships, rather
than something this project did by hand and then forgot.

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
- Each release now gets a **GitHub Release**, created by the release workflow
  with that version's changelog section as its body. Previously a version could
  ship to npm while the releases page still advertised the one before it.

### Changed

- The `upkeep` rule now also asks the agent to check for a newer Praxis release
  at the start of work, and to offer `/praxis-upgrade` when one exists. It never
  upgrades unprompted and skips silently when the registry is unreachable.
- Consumer-CI documentation now covers **non-Node projects**: Python and other
  repos pin the CLI with `npm exec --yes --package=@pragmatic-labs/praxis@<version>`
  instead of adding a `package.json`, a lockfile, or committed `node_modules`.

### Upgrading

Set `methodology: "0.3.0"` in `praxis.yaml` and run `praxis sync` — or run
`praxis sync` in an interactive terminal and accept the bump prompt. As of
0.2.0, `praxis check` fails until the pin matches the installed CLI, so both
move together.

Two things beyond the routine bump:

- **If you have the `upkeep` package installed, this arrives automatically** —
  it is not opt-in. The upkeep rule now asks your agent to check for a newer
  Praxis release at the start of work and offer `/praxis-upgrade`. It never
  upgrades unprompted and stays silent when the registry is unreachable, but it
  does add ~4 always-loaded lines and one new command to your emitted
  methodology.
- **The `changelog` package is opt-in.** Nothing changes unless you add
  `changelog` to `packages:` in `praxis.yaml`. Do that if you want the practice
  — a `CHANGELOG.md` reminder plus `/praxis-changelog` — in your own repo.

If you install neither, this is a pin-only upgrade: no emitted file changes.

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
