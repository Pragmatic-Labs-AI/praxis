---
praxisAnchors:
  - type: path
    target: src/anchors.ts
  - type: path
    target: src/merge.ts
  - type: path
    target: src/merge-json.ts
  - type: path
    target: src/sync.ts
  - type: path
    target: src/program.ts
  - type: path
    target: src/path-safety.ts
  - type: section
    target: docs/wiki/decisions.md#11-decision-record
---
# Architecture map

A navigational compression of the implementation shape. The focused wiki pages
are the canonical design home; `docs/ARCHITECTURE.md` is now a thin redirect
here.

## Technology choices (D1)

| Concern | Choice | Rationale |
|---|---|---|
| Language / runtime | TypeScript, Node 22+ (engines `>=22.12.0`, the floor locked `commander@15` requires; Node 20 is EOL) | `npx` distribution; ecosystem for the text work below |
| Distribution | `npx` bin entry, optional devDependency | Zero-install entry; pinned + CI-runnable when adopted |
| CLI parsing | `commander` (small) | Minimal command surface; *simplicity first* |
| Merge engine | **text-level block splice** (no markdown AST) | Preserves user prose byte-for-byte; see [merge-engine](merge-engine.md) |
| Manifest validation | `zod` | Validates `praxis.yaml` against the manifest schema |
| Tests | `vitest` | TS-native; runs conformance + unit |
| Dry-run diffs | a diff library | Preview before any write |

**Why TS/Node over a Go/Rust single binary:** the hot path is text manipulation
(block splicing, emitter output), not compute; `npx` reach matches the audience
(people configuring AI coding tools); and the npm ecosystem covers everything the
tool needs. A single binary would buy faster startup at the cost of distribution
— not worth it here.

## The pipeline

Methodology **source** (`packages/<layer>/<pkg>/`) → **emit** (per-tool, per
artifact kind) → **merge** (fold into existing files without clobbering). One
neutral source, per-tool outputs (Claude Code, OpenAI Codex, and generic AGENTS.md).

## `src/` module roles

| File | Role |
|---|---|
| `cli.ts` / `program.ts` | command surface (`praxis` / `sync` / `check`) — commander |
| `init.ts` | target/stack detection → default manifest → preview → write+apply (D17/D47) |
| `manifest.ts` | load/validate `praxis.yaml` (zod) |
| `packages.ts` | load `package.yaml` manifests; `resolve()` enforces `requires`/`conflicts` (D20/D21) and the Layer 2 `stack` rule against the manifest's `stacks` (D30) |
| `emit.ts` | turn package `provides` into coalesced per-tool artifacts, including Codex rules/skills/security/plugins |
| `codex-security.ts` | hash-protected permission-profile TOML + command-rule rendering/reconciliation |
| `codex-marketplace.ts` | Codex marketplace entry reconciliation with sidecar ownership hashes |
| `shared-instructions.ts` | deterministic parity check for project-owned Claude+Codex shared blocks (D48) |
| `permissions.ts` | closed capability vocabulary (zod enum) for `safe-permissions` (D19) |
| `plugins.ts` | validate `plugins.yaml` (marketplace + `enable[]`) for `external` packages; fails loud on `@marketplace` mismatch (D28) |
| `anchors.ts` | deterministic knowledge-anchor detector for D26/D27 Tier 2 (`path`, `command`, `section`) |
| `merge.ts` | text block-splice merge for markdown (managed `praxis:begin/end` blocks) ([merge-engine](merge-engine.md), D7) |
| `merge-json.ts` | JSON-aware merge for `.claude/settings.json`; `reconcileSettings` owns permissions+plugins in one pass; `_praxis` ownership key (D18/D19/D28) |
| `sync.ts` | reconcile repo → manifest; diff + confirm; conflict-not-clobber; prunes orphans of removed packages (D46); every write/delete goes through `resolveContained` (D54) |
| `path-safety.ts` | `resolveContained(root, relPath, context)` — realpath-based containment guard; walks to the nearest existing ancestor and hard-fails any escape from the canonical target-repo root; used by `sync.ts` writes+prune, `packages.ts` local roots, `emit.ts` package-source loads. No trust override — refusal is the contract (D54) |

## Methodology source — `packages/`

Layout is `packages/<layer>/<pkg>/` with the **layer as primary axis** so all
parts of a package stay together (D16). Current packages:

| Package | Layer | Provides | What it ships |
|---|---|---|---|
| `karpathy-claude` | layer1 | rules | tool-neutral Layer 1 behavioral rules |
| `safe-permissions` | layer1 | permissions | tool-neutral `permissions.yaml` → per-tool settings (D18/D19, opt-in) |
| `instruction-upkeep` | layer1 | rules, commands | standing reminder + `/praxis-instructions` (D22/D23, renamed D34) |
| `session-handoff` | layer1 | rules, commands | standing reminder + `/praxis-handoff`; carries work across a session boundary (resume) and an agent boundary (delegated execution — for parallelism *or* context/budget isolation) (D24/D37/D38) |
| `wiki-memory` | layer1 | rules, commands | standing reminder + `/praxis-wiki` (D25) |
| `upkeep` | layer1 | rules, commands | standing reminder + `/praxis-upkeep` — unified check+audit+wiki entry point (D29, widened to a full front gate in D31; sub-skill rules defer to it, D39) |
| `capture-codebase-patterns` | layer1 | commands | `/praxis-capture-codebase-patterns` — captures the team's own patterns from exemplar modules into a project-local `codebase-patterns` package on the D49 rails (D50); commands-only, the generated local package carries the rules |
| `node-recipes` | layer2 (`stack: node`) | rules | path-scoped TS/Node authoring craft recipe (D30) |
| `node-testing` | layer2 (`stack: node`) | rules | path-scoped unit-vs-integration test-layer recipe (D30) |
| `python-backend-recipes` | layer2 (`stack: python-backend`) | rules | path-scoped Python authoring craft recipe (D30) |
| `python-testing` | layer2 (`stack: python-backend`) | rules | path-scoped pytest test-layer recipe (D30) |
| `react-components` | layer2 (`stack: react`) | rules | path-scoped React component-authoring recipe; defers general TS craft to `node-recipes` (D30) |
| `react-testing` | layer2 (`stack: react`) | rules | path-scoped React Testing Library test-layer recipe (D30) |
| `ponytail`, `drawio` | external | plugins | declarative plugin refs; Ponytail is verified for Codex, Draw.io remains Claude-only |

`layer2/` is **flat** (one dir per package; each `package.yaml` declares its
`stack`, D30) — all three planned stacks (`node`, `python-backend`, `react`)
now ship recipe packages; only `node` is dogfooded in Praxis's own `praxis.yaml`
(it is the only stack with code here). `decision/` (e.g. `memory/`) is future.

## Merge engine

The merge contract moved to [merge-engine](merge-engine.md). Read it for owned
files vs block splice, conflict-not-clobber, JSON permission merge, and the
idempotency invariants. See [packages-and-emit](packages-and-emit.md) for the
artifact-kind delivery routing, and [gotchas](gotchas.md) for the constraints
that bite.
