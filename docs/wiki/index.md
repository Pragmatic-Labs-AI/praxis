---
praxisAnchors:
  - type: path
    target: README.md
  - type: path
    target: CLAUDE.md
  - type: path
    target: AGENTS.md
  - type: path
    target: docs/wiki/decisions.md
  - type: section
    target: docs/wiki/decisions.md#11-decision-record
---
# Praxis knowledge wiki — index

Durable, in-repo knowledge a fresh session reads instead of re-deriving. The
wiki is the canonical home for durable project/design knowledge. **Code and
config remain the source of truth for derived facts**; decisions and design intent
live here so drift can be surfaced for human judgment instead of silently
flattened into "code wins."

Read this index first, then follow the links that bear on your task.

## Pages

- [orientation](orientation.md) — what Praxis is in five lines, and which
  canonical file answers which question (the map of maps).
- [architecture-map](architecture-map.md) — canonical technology-choice table
  (D1), and how the parts fit: `src/` module roles, the `packages/` set (layer1
  + layer2 + external), and the emit → merge pipeline.
- [decisions](decisions.md) — canonical append-only D<N> decision ledger; opens
  with a thematic **decision digest** (the load-bearing decisions grouped by
  theme) over the full table. Preserve numbers because code and docs cite them.
- [decisions-archive](decisions-archive.md) — rows moved out of the main ledger
  because they are fully superseded/historical, D-numbers intact (verbatim, with
  the superseding row noted).
- [merge-engine](merge-engine.md) — canonical merge contract: owned files vs
  block splice, conflict-not-clobber, JSON permission merge, and idempotency.
- [interaction-model](interaction-model.md) — canonical: imperative-entry/
  declarative-truth (D2), the `praxis`/`sync`/`check` command surface (D3), the
  first-run Quick-start/Customize wizard (D17→D33), multi-stack
  detect-then-confirm (D5/D30/D33), and the `praxis.yaml` manifest schema
  (D4, D6, D15) incl. project-local `./` package entries (D49) and the
  hand-added `workspace:` hub section (D53), plus peer-native shared
  instruction parity (D48).
- [packages-and-emit](packages-and-emit.md) — canonical: the two-layer
  methodology model, the on-disk package layout (D16), the package/manifest
  model (`provides` drives emit, `requires`/`conflicts`), the four artifact
  kinds (incl. `plugins`/D28), project-local packages in the target repo (D49),
  the derived `workspace` pseudo-stack and its `workspace` package (D53), and
  how to add a new package by mirroring prior art.
- [emitters](emitters.md) — canonical per-tool emit contract: the permission
  emitter (D19), the command emitter (D22), the plugin-marketplace emitter
  (D28), and `.claude/rules/` vs `AGENTS.md` consumption.
- [workflows](workflows.md) — build/test/run commands, the CI gate order, the
  branch-PR-green-merge convention, and the npm release/publish step (D32).
- [self-hosting](self-hosting.md) — canonical dogfooding milestone: Praxis
  installs its own methodology and `npm run selfcheck` gates drift in its own
  CI.
- [onboarding](onboarding.md) — canonical: project facts vs methodology, the
  D14 sentinel/skill mechanism for new repos, and `instruction-upkeep`'s
  ongoing currency/completeness role for existing repos.
- [roadmap](roadmap.md) — done vs to-do, synthesized from the decision ledger;
  Layer 2 is bootstrapped with all three planned stacks shipped — `node`,
  `python-backend`, `react` (D30).
- [gotchas](gotchas.md) — non-obvious constraints that bite: AGENTS.md isn't read
  by Claude Code, no markers in owned files, the `_praxis` JSON-marker placement,
  "memory" = the agent's memory, Praxis never calls an LLM.
- [glossary](glossary.md) — project vocabulary in one place: methodology layer,
  Layer 1/2, stack/stacks, harness, emitter, target, conformance, package,
  manifest, anchor, decision recipe, and the "memory = the agent's, not the
  app's" disambiguation.

## Source-of-truth anchors

- `README.md` — the newcomer entry point (what Praxis is, install, the two
  layers, the command surface, dev workflow). A *derived* overview: the
  peer-native `CLAUDE.md` / `AGENTS.md` project instructions and this wiki win
  on conflict; keep the README in step with them.
- `docs/wiki/decisions.md` — the canonical decision record (D1–D58 plus open
  rows), fronted by a thematic decision digest. Append new numbered decisions
  here; fully superseded rows move verbatim to
  [decisions-archive](decisions-archive.md).
- `docs/ARCHITECTURE.md` — fully retired; now a thin redirect to this index.
  The build-order history it used to hold lives in
  [roadmap](roadmap.md#build-order-historical).
- `CLAUDE.md` and `AGENTS.md` — peer native project instructions; their D48
  shared blocks carry the same project facts while target-specific content may differ.
