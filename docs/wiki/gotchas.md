# Gotchas — non-obvious constraints

Things that look like bugs but are deliberate, and traps that bite. Each links the
canonical rationale in the relevant wiki page or transitional architecture doc.

## "Memory" means the agent's memory, not the app's

In Praxis, *memory* always = the AI coding tool's curated, file-based instruction
layer (`CLAUDE.md`, `.claude/rules`, skills, the knowledge wiki). It is **never** a
runtime memory backend for the target application (Mem0, Zep, Letta, Graphiti).
Wiring a persistence backend into a user's app is implementation — out of scope.
The most Praxis ships there is a Layer 2 *decision recipe*. (D8; CLAUDE.md has a
whole section on this.) The deferred runtime-memory backends were researched and
**deferred** in D25 because each carries a server/daemon/binary that can't reduce
to inert Praxis-owned config.

## Praxis never calls an LLM (D12)

Deterministic CLI: no API keys, no network model calls, no non-determinism. Work
needing intelligence is delivered *as instructions* for the ambient agent to
execute. Don't propose a feature where the Praxis binary itself "figures out" or
"generates" project facts — that's the agent's job.

## `AGENTS.md` is NOT read by Claude Code — by design

Claude Code reads `CLAUDE.md`, not `AGENTS.md`. In Praxis's own repo the emitted
`AGENTS.md` serves Codex and generic tools that follow the convention. Praxis
does **not** auto-add an `@AGENTS.md` import to `CLAUDE.md`: Claude already loads
the equivalent split `.claude/rules/`, so importing would duplicate methodology.
Dual Claude+Codex repos keep peer project-owned shared blocks instead (D48).
([emitters](emitters.md), [onboarding](onboarding.md).)

## Shared project blocks are parity markers, not managed ownership

`praxis:shared-project` blocks carry no hash and remain project-owned. `check`
compares them; `sync` never overwrites them or chooses a winner. Upkeep resolves
semantic drift with user approval. This keeps both native files complete if
Praxis is removed. ([merge-engine](merge-engine.md), D48.)

## No `praxis:begin/end` markers in owned files

Hashed `praxis:begin/end` markers exist only where Praxis edits *inside* a
user-owned file (`AGENTS.md` managed block). Owned files
(`.claude/rules/*.md`, `.claude/commands/praxis-*.md`)
are whole-file place/replace — there's nothing to delimit, so markers would be
inert noise. A conformance test asserts no markers leak into owned files.
([emitters](emitters.md).)

## The `_praxis` JSON marker must be a *sibling* of `permissions`, never inside it

JSON has no comments, so `.claude/settings.json` records Praxis ownership in a
top-level `_praxis` key. The Claude Code settings schema sets top-level
`additionalProperties: true` but `permissions` is `additionalProperties: false` —
so the marker inside `permissions` would be schema-invalid.
([merge-engine](merge-engine.md), D18/D19.)

## Plugin packages are declarative — Praxis never installs a plugin (D28)

An `external`-layer `plugins` package emits `extraKnownMarketplaces` +
`enabledPlugins` into `.claude/settings.json` and **nothing else** — no `npx`, no
`git clone`, no shell-out anywhere (an earlier installer exploration was rejected
for exactly this reason; D12 holds). The marketplace reference is committable,
inert config; **Claude Code itself** prompts to install/enable on folder-trust.
Don't propose making `praxis sync` fetch or run a plugin. ([emitters](emitters.md).)

Codex emission is compatibility-gated: a package needs verified `codex` metadata.
Missing ownership sidecar state is handled conservatively; Praxis adopts an exact
desired entry but never guesses that a differing entry is safe to overwrite.

## A commit SHA in a Claude Code marketplace `ref` is functional-but-unspecified (D55)

Every shipped first-party `external` plugin source pins a full commit SHA, and
conformance rejects an unpinned one (D55). But Claude Code's marketplace-source
schema documents `ref` as "branch or tag": the SHA is *accepted* (the field has
no format constraint) and GitHub serves any reachable commit, so pinning works —
it is just **unspecified-though-functional**, unlike Codex's *documented*
plugin-source `sha` field. Don't "fix" the pinned SHAs back to tags to match the
doc wording; a tag is a moveable label, not an integrity boundary. If Claude Code
ever rejects a SHA `ref`, that is the upstream change to watch, not a Praxis bug.
([decisions](decisions.md) D55.)

## Codex project config requires trust and a modern client

Project `.codex/config.toml` and `.codex/rules/*.rules` load only after the repo is
trusted. Permission profiles require Codex 0.138+ and do not compose with legacy
`sandbox_mode` / `[sandbox_workspace_write]`; Praxis reports those settings as a
conflict and leaves them untouched. User/global Codex settings can still override
project defaults. ([emitters](emitters.md).)

## The Codex TOML managed block is prepended, not appended

`reconcileCodexConfig` (`src/codex-security.ts`) writes its managed block
*before* any existing `.codex/config.toml` content, never after. TOML has no
"return to root table" syntax — a bare `key = value` line belongs to whichever
`[table]` header precedes it, all the way to EOF or the next header. Appending
the block risks its own `default_permissions = ...` line being silently scoped
under a user's trailing `[table]`, disabling the safety profile with no
conflict reported (nothing in `externalConflicts` would catch it — the key
name legitimately doesn't appear at top level in the user's file). Prepending
guarantees root-table scope regardless of what the user's file contains.

## Marketplace entry hashes must be key-order-insensitive

`hashEntry` (`src/codex-marketplace.ts`) canonicalizes (deep key-sorts) an
entry before hashing. Hashing raw `JSON.stringify` output makes the ownership
check sensitive to cosmetic key reordering (a formatter, a hand edit) with
identical values — the entry then permanently reads as user-edited, and the
conflict is unrepairable except by hand-editing the committed sidecar. Any
future hash-based ownership check over JSON must canonicalize first.

## `praxis init --yes` must not depend on which CLIs happen to be on PATH

`InitContext` carries two target lists: `detectedTargets` (repo artifacts *and*
PATH-installed CLIs — fine for seeding an interactive prompt the user then
confirms) and `detectedTargetsFromArtifacts` (repo artifacts only).
`defaultManifest`'s fallback uses the artifacts-only list, because a
non-interactive `--yes` install must give the same manifest for the same repo
regardless of which agent CLIs happen to be installed on the machine running
it. Interactive mode can keep suggesting from the wider, PATH-inclusive list
since the user reviews it before anything is written. (`src/init.ts`.)

## Conflict, never clobber

Both merge engines detect user edits to managed content (markdown via per-block
`sha256`; JSON via the `_praxis` record) and **surface a conflict rather than
overwrite**. Invalid JSON is refused, never clobbered. (D10.)

## `requires` won't auto-install

A package's `requires` is satisfied *only* by another package the user also
selected — not auto-added, not by the user claiming their repo already has it. The
loader refuses loudly. Don't "helpfully" auto-resolve dependencies. (D21.)

## CLAUDE.md edits are gated

Per project memory: never edit `CLAUDE.md` as a sub-step of another task — only via
an explicit, user-invoked `/praxis-instructions`. The instruction layer is curated, not
incidentally modified.
