---
praxisAnchors:
  - type: path
    target: README.md
  - type: path
    target: CLAUDE.md
  - type: path
    target: AGENTS.md
  - type: path
    target: docs/ARCHITECTURE.md
  - type: path
    target: docs/wiki/decisions.md
  - type: section
    target: docs/wiki/decisions.md#11-decision-record
---
# Orientation

**Praxis is a TypeScript/Node `npx` CLI that installs an AI *methodology layer*
into a codebase** — the meta-development rules and authoring recipes that make AI
coding agents produce correct, conformant work. It is **not** implementation
scaffolding and **not** an application config generator. It writes *only* the
methodology layer (agent instructions, native workflows, methodology permissions
and plugin metadata, its own manifest); it never touches the target project's
application code, deps, or runtime infra
(`AGENTS.md`/`CLAUDE.md` non-negotiables; see "Scope boundaries" below).

Praxis written in TypeScript ≠ the stacks its Layer 2 recipes *target*
(`node`, `python-backend`, `react` — D30). Don't conflate them.

## What sets Praxis apart

**The differentiated core is the gate + distribution machinery** (canonical
statement — other pages link here rather than restating it): methodology
shipped as **versioned, pinned packages** (D4/D6, D59), folded into an
*existing* project by a **composition/merge** step that never clobbers project
content ([merge-engine](merge-engine.md)), emitted **per-tool from one neutral
source** ([emitters](emitters.md)), and kept honest by a **drift-checking CI
gate** (`praxis check`, D26/D27). Instruction *content* is the most
commoditized part of the landscape (community rulesets, native agent memory,
plugin marketplaces); versioned, drift-checked, multi-tool instruction
*management* has no incumbent — genuine version pinning is enforced (D59),
not merely recorded.

The curated content — Layer 1 behavioral rules + Layer 2 stack recipes
([packages-and-emit](packages-and-emit.md)) — is the **payload** that rides
this machinery: the starting set and the credibility demo, with teams expected
to ship their own content through the same machinery over time. (Repositioned
from the earlier "Layer 2 recipes are the differentiated core" framing by the
2026-07 product review — D42.)

## Scope boundaries (load-bearing)

These bound every feature. They are **not duplicated here** — the peer-native
`CLAUDE.md` / `AGENTS.md` shared "Non-negotiables" section is canonical for
"methodology, not implementation" and "tool-neutral by construction";
[gotchas](gotchas.md) is canonical for ""Memory" means the agent's memory" and
"Praxis never calls an LLM (D12)". Read both before proposing a feature that
touches what Praxis writes.

## Which file answers which question

| You want to know… | Read |
|---|---|
| A newcomer overview — what Praxis is, install, layers, commands | `README.md` (derived; defers to the peer-native project instructions and this wiki on conflict) |
| The non-negotiable rails (what you must/must not do) | `AGENTS.md` (Codex/generic) and `CLAUDE.md` (Claude Code) |
| The structure and the *why* behind every design choice | Start at [index](index.md); `docs/ARCHITECTURE.md` is now a thin redirect here |
| The load-bearing decisions grouped by theme (overview) | [decisions](decisions.md) "Decision digest" |
| The full decision history (D1–D61, with status) | [decisions](decisions.md) |
| Build/test/run + conventions | The shared "Working in this repo" section in `CLAUDE.md` / `AGENTS.md`, or [workflows](workflows.md) |
| Standing behavioral reminders loaded every session | `.claude/rules/praxis-*.md` or managed `AGENTS.md` blocks |

## The mental model

**Imperative entry, declarative truth** — the `npm install` pattern. One command
(`praxis`) does the smart thing and records what it did in a visible, committed,
hand-editable manifest (`praxis.yaml`). Thereafter the manifest is the source of
truth: customize = edit `praxis.yaml`, run `praxis sync`. Command surface is only
`praxis` / `praxis sync` / `praxis check` — no `add`/`remove`. See
[interaction-model](interaction-model.md) for the full wizard, stack-detection,
and manifest contract.

## Status

Self-hosting. The interactive init flow, merge/prune engine, manifest loader,
all three Layer 2 stacks, project-local packages (D49) with the
`capture-codebase-patterns` skill (D50), and Claude Code / OpenAI Codex /
generic `agents-md` emitters are built; Praxis installs its own methodology and
`praxis check` gates drift in its own CI. Remaining work includes authoring
skills, deeper recipe coverage, and additional tool emitters. See
[architecture-map](architecture-map.md), [packages-and-emit](packages-and-emit.md),
and [roadmap](roadmap.md).
