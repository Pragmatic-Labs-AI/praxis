---
description: Bootstrap, update, or lint the project knowledge wiki — a durable, in-repo, linked-markdown memory the agent reads at the start of work and maintains as the project changes (Karpathy "LLM wiki" pattern).
argument-hint: [optional-topic-to-focus]
allowed-tools: Read, Glob, Grep, Bash(git log:*), Bash(git diff:*), Bash(ls:*), Bash(mkdir:*), Bash(date:*), Write, Edit
---

# Project knowledge wiki

You are curating a durable knowledge wiki for this project: linked markdown pages
of long-lived knowledge that a future session reads instead of re-deriving. This
is the agent's cross-session memory **of the project** — version-controlled and
shared with the team. It is NOT a per-session handoff (transient — that is
`/praxis-handoff`) and NOT the authored agent instruction layer
(that is `/praxis-instructions`).

The wiki has two kinds of durable knowledge:
- **Derived summaries** compress code, config, and canonical docs. The underlying
  source wins on conflict; fix the wiki.
- **Canonical intent** records decisions, rationale, scope, and design intent —
  the "why" that is not fully derivable from code. When code and canonical intent
  diverge, surface the drift for human judgment instead of silently overwriting
  one with the other.

Focus: $ARGUMENTS — if empty, refresh and lint the whole wiki at a high level.

## Phase 1 — Locate or create the wiki

Use the first of these that already exists; otherwise create the first one
(run `mkdir -p` before writing):
1. `docs/wiki/`
2. `wiki/`
3. `.praxis/wiki/`

- Existing entries: !`ls -R docs/wiki wiki .praxis/wiki 2>/dev/null || true`
- Today (for log entries, do not guess): !`date +%Y-%m-%d`

Front the wiki with two entry-point files; create them if missing:
- `index.md` — a catalog of every page: a link and a one-line summary each.
- `log.md` — an append-only record of wiki changes, newest last, each entry dated
  (e.g. `## [YYYY-MM-DD] <added|updated|removed> — <page>: <why>`).

## Phase 2 — Ingest durable knowledge

Gather long-lived facts a future session would otherwise have to re-derive:
- Architecture and how the parts fit; key directories/modules and their roles.
- Hard-won gotchas, non-obvious constraints, and their underlying cause.
- Workflows — build/test/run/release — and the *why* behind any unusual step.
- Decisions and their rationale. Keep a single canonical `decisions.md` ledger
  when decisions are numbered or cited from code/docs: append-only, never
  renumbered, never scattered across topic pages.
- Useful answers or analyses derived in this session — file them back so they
  don't vanish into chat history.

Sources: the code and config, existing docs, recent git history (`git log`,
changed files), and what was learned in this session. Capture **durable**
knowledge only — not transient session state, not the instruction rules. Never
invent a fact that isn't backed by the code, config, a canonical doc, or the
user's answer. When unsure, ask rather than guess.

## Phase 3 — Write entries and update index + log

- One topic per page; a short, linkable page beats a sprawling document.
- Update the existing canonical page instead of creating a near-duplicate.
- Cross-link related pages so retrieval is "read the index → follow the links."
- Keep the taxonomy obvious: `orientation.md` as the map, focused design/topic
  entries, one `decisions.md` ledger when needed, `workflows.md` for commands, and
  `gotchas.md` for traps with causes.
- Prefer linking a canonical source over restating it (restated facts drift).
- Add or update `praxisAnchors` frontmatter for the canonical sources a page
  depends on. Phase-2 anchors are page-level and deterministic only:
  - `type: path`, `target: repo/relative/path`
  - `type: command`, `target: npm run <script>` or `npm <script>`
  - `type: section`, `target: docs/file.md#heading-slug`
  Keep staleness/hash tripwires out for now; those are future advisory signals.
- Update `index.md` so every page is listed and reachable, and append a `log.md`
  entry for each change.

## Phase 4 — Lint

Health-check the wiki and fix what you can (ask before large deletions):
- **Contradictions** — derived summaries that disagree with current code/config
  lose to the source; fix the wiki. Canonical-intent entries are different: if
  code and intent diverge, report the drift and route it to a decision/update
  step (or `/praxis-instructions` for instruction-layer changes) instead of deciding
  automatically. Two wiki entries that disagree resolve to the more recent /
  authoritative / better-supported claim, with the resolution noted.
- **Stale claims** — derived facts the current code has invalidated: fix or
  remove them. For canonical-intent drift, preserve the intent and report the
  mismatch for human judgment.
- **Orphan pages** — pages not linked from the index or any other page: link or
  retire them.
- **Missing cross-references** — related pages that don't link each other: connect
  them.
- **Broken anchors** — run `praxis check` if available; fix any
  `praxisAnchors` entry whose path, command, or section no longer resolves.

## Phase 5 — Report

Print what you created, updated, and removed (with paths), the lint issues found
and how you resolved them, and name the single most useful entry a fresh session
should read first.

Ask before large rewrites or deletions — show the list and confirm.
