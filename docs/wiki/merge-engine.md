---
praxisAnchors:
  - type: path
    target: src/merge.ts
  - type: path
    target: src/merge-json.ts
  - type: path
    target: src/emit.ts
  - type: path
    target: src/shared-instructions.ts
  - type: path
    target: conformance/merge-engine.conformance.test.ts
  - type: path
    target: conformance/merge-json.conformance.test.ts
  - type: section
    target: docs/wiki/decisions.md#11-decision-record
---
# Composition / merge (the core engineering problem)

Three modes: *place* (fresh repo), *replace*, and *merge* (fold into an existing
instruction file). Merge is the load-bearing, hard one. The relationship is
**bidirectional**: Praxis writes methodology in, *and* the user/agent edits these
files — and good edits must be able to flow **back** into the methodology source
and re-ship. The design below serves both directions.

## Prefer referencing over inlining

The least merge is no merge. Where the target tool supports includes, Praxis owns
**whole files** and the instruction file merely references them:

| Target | Strategy |
|---|---|
| Claude Code | Own `.claude/rules/praxis-*.md` and `.claude/commands/praxis-*.md` wholesale. **Praxis never edits the user's `CLAUDE.md`** without onboarding approval. |
| OpenAI Codex | Managed `AGENTS.md` blocks plus owned `.agents/skills/praxis-*/SKILL.md`; path globs become applicability prose. |
| Cursor | Own files in the rules directory. Near-zero merge. |
| AGENTS.md / copilot-instructions.md | Flat files, no include standard → content is **inlined** via block splice. |

Skills, command files, and `.claude/rules/` files are whole files Praxis owns —
*place*/*replace*, never merged.

## Peer-native shared project facts (D48)

When Claude Code and Codex coexist, project facts remain native and project-owned
in both `CLAUDE.md` and `AGENTS.md`; neither imports or replaces the other. One
unhashed `praxis:shared-project` block in each file declares the exact content
that must match. Everything outside those blocks may differ by target.

`praxis check` compares the two blocks deterministically (normalizing only line
endings) and fails on missing, duplicate, or mismatched blocks. It does not judge
whether the prose is true. The upkeep instruction pass audits that prose against
repo reality and asks before updating both copies. `praxis sync` never chooses a
winner or writes either project-owned block; it continues to reconcile only
generated methodology. If Praxis is removed, both native files remain complete
and the marker comments are inert.

Verified against Claude Code docs: it reads `CLAUDE.md` (not `AGENTS.md`) and
auto-loads `.claude/rules/*.md`; `@path` imports are recursive (<=4 hops) but
**load into context at launch — referencing saves duplication, not tokens**;
block-level HTML comments are stripped from context before injection, so the
`praxis:begin/end` markers cost zero Claude tokens yet remain on disk for the
engine.

## Block splice, not markdown AST

Merge operates on the file as **text**, not a parsed tree. **Full-document AST
round-tripping is rejected (D7):** `remark`/`unified` re-serialize the *entire*
file on write, normalizing the user's hand-authored prose (bullet style, line
reflow, escaping, spacing) even outside Praxis regions — the exact clobbering the
tool exists to prevent.

- **Managed regions** delimit Praxis-owned content. The begin-marker carries a
  hash of the content Praxis last emitted:

  ```markdown
  <!-- praxis:begin karpathy-claude sha256=ab12... (managed by praxis - edit praxis.yaml then run: praxis sync) -->
  ...emitted methodology...
  <!-- praxis:end karpathy-claude -->
  ```

- **Splice only the managed span.** Locate begin/end markers, replace just that
  text span, leave every other byte untouched. The user may relocate the whole
  block anywhere — it is found by marker, not by position.

- **Structural parsing only for first placement.** When injecting a block into a
  file that has no markers yet, a light heading scan picks the anchor (e.g. after
  the H1). Only Praxis's *own* generated content is ever serialized — never the
  user's.

- **Idempotent by construction.** Re-running `sync` with an unchanged manifest is
  a no-op diff. Verified by conformance tests, not assumed.

- **Preview always.** Every mutating run renders a diff first; `check` renders it
  and exits without writing.

## Edit-inside-managed-block: conflict, never clobber

On `sync`, compare each on-disk block against its recorded `sha256`:

- **hash matches** (user did not touch it) → safe to overwrite with newer
  methodology.
- **hash differs** (user edited inside the block) → **never silently
  overwrite.** Surface the edit and offer two paths: *promote upstream* (the
  change becomes methodology for every project, via the authoring skill) or *move
  it to a project-owned region* (outside any block, where Praxis never touches
  it).

This is the promotion loop: **project-specific** clarifications live outside
blocks and stay local; **general** lessons get lifted into the methodology source
and re-ship. The `memory` clarification is the canonical *general* case.

The hash lives **in the marker comment** (D11), making each block self-contained
and drift-detectable without a separate state file, and surviving the user moving
or copying the block. Marker migration across methodology versions remains open.

## JSON-aware merge for structured config

Some artifacts are **structured config, not prose** — emitted to Claude Code's
`.claude/settings.json`. Two artifact kinds land there: the permission policy
(D19) and, since D28, plugin-marketplace references (`extraKnownMarketplaces` +
`enabledPlugins`). JSON has no comments, so the marker trick above has no
equivalent. `src/merge-json.ts` is the analogue, mirroring the markdown engine's
contract in a comment-less format. Its entry point, **`reconcileSettings`**, owns
the whole `.claude/settings.json` in **one pass** for both concerns
(`reconcilePermissions` is now a thin wrapper kept for existing call sites); the
emitter emits at most one `settings` op per target so the two compose into a
single write:

- **Praxis owns only the rule strings it emits**, deep-merged into the host's
  `permissions.{allow,ask,deny}` arrays. User-added rules in the same arrays
  survive untouched (per-rule ownership).
- **Ownership is recorded in a self-contained top-level `_praxis` key** — the
  JSON-native marker, honoring D11 (no separate lockfile). This is schema-valid:
  the Claude Code settings schema sets top-level `additionalProperties: true`
  while `permissions` is `additionalProperties: false`, so the marker must be a
  **sibling** of `permissions`, never inside it.
- **Conflict, never clobber (D10), per bucket.** If a rule recorded in `_praxis`
  is missing on disk, the user edited managed content: that bucket is left exactly
  as-is and surfaced as a conflict (`permissions.<bucket>`, and for plugins
  `plugins.marketplaces` / `plugins.enable`).
- **Plugins are owned the same way (D28).** `reconcileSettings` deep-merges only
  the `extraKnownMarketplaces` / `enabledPlugins` entries Praxis emits, tracked in
  the same `_praxis` record, with identical conflict-not-clobber and idempotency
  behavior. User-added marketplaces/plugins in the same objects survive untouched.
- **Removal on update.** Rules Praxis previously emitted but no longer ships are
  dropped; user rules and unrelated keys (`model`, `env`, `defaultMode`, ...)
  are preserved. Invalid JSON is refused, never clobbered.
- **Idempotent** by construction; verified by
  `conformance/merge-json.conformance.test.ts`.

Codex uses two additional structured reconcilers. `.codex/config.toml` carries a
hash-protected comment block and refuses colliding profile/legacy sandbox keys.
`.agents/plugins/marketplace.json` preserves user entries while a committed
`.praxis/codex-marketplace-state.json` sidecar hashes only Praxis-owned plugin
entries. The sidecar is necessary because the marketplace schema has no safe
extension point for ownership metadata.

## Prune: the manifest expresses absence (D46)

Declarative truth includes *removal*: a package deleted from `praxis.yaml` must
not leave its previously emitted artifacts behind (the gap observed at D34,
closed by the 2026-07 product review's P2). **No separate ownership ledger is
needed** — ownership is already legible on disk, so prune is simply
*(on-disk Praxis-owned set) − (manifest-implied set)*, computed in
`applyManifest` (`src/sync.ts`) from `planEmit`'s ops:

- **Owned files** are recognized by the `praxis-` filename prefix
  (`.claude/rules/praxis-*.md`, `.claude/commands/praxis-*.md`,
  `.agents/skills/praxis-*/SKILL.md`, and the Codex rules file); orphans are
  deleted. A user's own file matching the prefix would be flagged too —
  acceptable because deletion is always previewed, never silent.
- **Managed blocks** are recognized by their `praxis:begin <id>` markers;
  orphan blocks are spliced out as the true inverse of append (surrounding
  prose byte-identical). A user-edited orphan block (hash mismatch) is a
  **conflict, never a delete** — D10 extends to removal.
- **Settings** already self-prune: `reconcileSettings` drops
  recorded-but-no-longer-wanted entries via `_praxis` ("Removal on update"
  above). Prune adds nothing there.
- **Codex TOML/marketplace state** removes only intact, recorded Praxis content;
  missing marketplace state is conservative and edited entries conflict. If
  `marketplace.json` itself is gone but the sidecar remains, the sidecar is
  pruned — it has nothing left to describe ownership over.
- **`check` reports orphans as drift** (a `deleted`-status file report,
  non-zero exit), same as any other divergence from the manifest.

Verified by `conformance/prune.conformance.test.ts` (deletion on removal,
byte-identical splice, edited-orphan conflict, check-mode drift, idempotency).
