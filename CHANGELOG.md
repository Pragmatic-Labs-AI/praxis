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

- `praxis sync --dry-run` (`-n`) — print exactly what sync would write, then
  exit without writing. Previously there was no way to preview a rewrite.
- `praxis sync --force` — overwrite destinations that carry uncommitted changes,
  which sync now refuses to do by default (see below).
- `praxis check` and `praxis sync --dry-run` now print **what** drifted beneath
  each file instead of only that it did: per-rule deltas for
  `.claude/settings.json` (`permissions.deny: +Read(./.env.local) -Read(./.env.*)`)
  and a `+N/-M lines` summary elsewhere.
- `npm run docs:pins` — regenerates README.md's three copy-pasteable version
  pins (devDependency, npm-exec, global install) from the running CLI's own
  version, plus a matching `conformance` gate that fails the moment a pin
  drifts from it. Wired into npm's `version` lifecycle script, so `npm version
  <level>` bumps `package.json` and refreshes the pins in the same commit —
  this is also the first place this project documents that a release version
  bump is done with `npm version`.

### Changed

- **`read-secrets` no longer denies `.env` templates.** The emitted deny rules
  listed a blanket `.env.*` (Claude Code) and `**/.env*` (Codex), which blocked
  committed, secret-free templates — `.env.example`, `.env.sample`,
  `.env.template`, `.env.dist` — that an agent needs in order to author a real
  `.env`. Because deny beats allow in Claude Code, no consumer could carve them
  out downstream. Both emitters now derive from one enumerated list of
  secret-bearing names (`SECRET_FILE_PATTERNS`, `src/permissions.ts`).
- **The two emitters no longer disagree.** Claude Code denied a root-anchored
  `.env.*` while Codex denied `**/.env*` at any depth, so one repo got a
  different effective policy per target and Codex additionally swept in
  `.envrc`. Both targets now deny the same shapes, at the repo root and at any
  depth — which also closes a real gap for monorepos, where a nested
  `packages/api/.env` was previously readable under Claude Code.

### Fixed

- **`sync` silently deleted rules you added to `.claude/settings.json`.** The
  `_praxis.managed` block records what Praxis emitted, but it looks like the
  place to configure — and if you added a rule to *both* the live `permissions`
  block and that record, the next `sync` read your rule as a retired Praxis rule
  and removed it from the live block, with no conflict reported. That is the
  exact inverse of the "never clobbers rules you add" promise. The marker now
  carries an integrity hash and an inline do-not-edit notice; a hand-edited
  marker is reported as a `_praxis.managed` conflict and the file is left
  untouched. Rules added to the live block alone were never affected and still
  survive untouched.
- **`sync` now refuses to overwrite a tracked file with uncommitted changes**,
  naming the files and pointing at `--force`. An uncommitted edit has no
  committed copy to recover from. The refusal happens before any write, so the
  repository is left byte-identical.

### Upgrading

Run `praxis sync`. Two emitted files change: `.claude/settings.json` picks up a
`_comment` and `hash` inside its `_praxis` key plus the rewritten `read-secrets`
rules, and `.codex/config.toml` picks up the same rule rewrite. Neither touches
anything you configured; `check` reports the marker change as
`_praxis.managed: ownership record updated`.

Three things worth knowing:

- **This narrows what is denied, so read it before upgrading.** The
  `read-secrets` replacement is an enumerated list (`.env`, `.env.local`,
  `.env.*.local`, `.env.development`, `.env.production`, `.env.staging`,
  `.env.test`, `*.pem`, `credentials*`), not a wildcard. A secret-bearing file
  whose name falls outside that list — say `.env.secrets` or `.env.experimental`
  — is now **readable** where the old blanket rule denied it. That is the
  deliberate cost of making templates readable at all: a blanket rule cannot be
  carved out downstream, and character-class negation leaks worse
  (`.env.[!e]*` plus `.env.e[!x]*` misses `.env.experimental` entirely while
  looking like it covers it). If your repo keeps secrets in a non-conventional
  `.env.*` name, either rename it to one of the covered shapes or add your own
  `Read(./.env.yourname)` deny rule to `.claude/settings.json` — user-added
  rules sit outside the Praxis-managed entries and survive `sync`.
- **If you had hand-edited `_praxis.managed`, this upgrade is the moment to
  undo it.** A file written by an older Praxis has no hash, so it is trusted
  once — the integrity check protects you from the *next* sync onward. Move any
  rules of your own out of `_praxis.managed` and into the `permissions` block
  above it before syncing; rules there are preserved by design.
- **The uncommitted-changes guard may stop a `sync` that used to succeed**, for
  example in a script that edits an emitted file and re-syncs without
  committing. Add `--force` to those call sites. The guard covers only tracked,
  modified files: untracked files are not guarded (after `init` everything
  emitted is untracked, and guarding it would refuse the normal init → sync
  flow), and neither are gitignored ones — a repo that gitignores
  `.claude/settings.json` gets no protection from this guard, though the
  ownership-marker check above still applies.

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
