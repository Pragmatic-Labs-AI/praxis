---
praxisAnchors:
  - type: path
    target: src/program.ts
  - type: path
    target: src/init.ts
  - type: path
    target: src/sync.ts
  - type: path
    target: src/manifest.ts
  - type: path
    target: conformance/cli-surface.conformance.test.ts
  - type: path
    target: conformance/manifest.conformance.test.ts
  - type: path
    target: conformance/workspace.conformance.test.ts
  - type: section
    target: docs/wiki/decisions.md#11-decision-record
---
# Interaction model and the manifest

How a user talks to Praxis, and where the resulting state lives. Canonical for
the CLI surface, the first-run wizard, stack detection, and `praxis.yaml`.
Decisions D2, D3, D4, D5, D6, D15, D17, D30, D33, D49, D52, D53.

## Imperative entry, declarative truth (D2)

The model is the `npm install` pattern, not a pure-imperative or pure-declarative
extreme:

- **Imperative entry.** One command (`praxis`) does the smart thing immediately.
- **Declarative truth.** It records what it did in a visible, committed,
  hand-editable manifest (`praxis.yaml`). The manifest is the source of truth
  thereafter.
- **They converge.** Customizing means editing the manifest and running `sync`;
  re-runs reconcile the repo to the manifest. Idempotency is a property of
  reconcile, not bolted on.

## Command surface — the whole imperative surface (D3)

- `praxis` — first-run wizard; apply.
- `praxis sync` — reconcile repo → `praxis.yaml`; offer newer methodology; diff +
  confirm.
- `praxis check` — dry-run; report generated drift, broken anchors, and dual
  Claude+Codex shared-project parity; non-zero exit for CI.

No `add`/`remove`/`list`. All customization is *edit `praxis.yaml`, then sync* —
one obvious way to change things, least surface to keep coherent.

## First run

A **short wizard** with the fork as its first question:

- **Quick start** — recommended defaults → preview diff → confirm.
- **Customize** — choose targets and packages (see below) → preview diff →
  confirm.

`--yes` skips prompts for non-interactive/CI use. Repeat `--target` to override
target detection.
The wizard always previews a single diff before writing; git is the undo.

**Built today (D33): the full fork.** `praxis init` first asks **Quick start vs
Customize** (`@clack/prompts` `select`):

- **Quick start** — apply the data-driven default manifest (see below) → preview →
  confirm.
- **Customize** — stack and package multiselects followed by the same always-shown
  target multiselect as Quick start, assembled by `manifestFromSelections(stacks, packages,
  targets)` helper in `src/init.ts` → preview → confirm.

Each decision after the initial choice is reversible, retaining the choices
already made, but the affordance differs by prompt type (D52 — fixing a
regression in the original D33 design):

- **Preview** is a `select` (arrow to an option, Enter chooses it), so an
  explicit **"← Back to targets"** menu item works correctly there.
- **Stacks/packages/targets** are `multiselect` checkbox pickers, where Enter
  always submits the checked items and only Space toggles a checkbox — an
  embedded "← Back" checkbox item looked identical to the preview's menu item
  but silently did nothing on arrow+Enter. Fixed by removing that item and
  aliasing **Backspace** to `@clack/prompts`' `cancel` action
  (`updateSettings`), so Backspace goes back one step on these three screens.
  Because clack collapses Escape/Ctrl+C/aliased-keys into one indistinguishable
  `cancel` signal, Escape and Ctrl+C also go back a step there (accepted
  tradeoff); only the very first **mode** screen still treats cancel as a full
  abort, since there is nowhere further back to go. Quick start returns from
  targets to the mode choice; Customize walks back through targets, packages,
  and stacks the same way.

This **closes D17's deferral** (the original minimal `init` shipped Quick-start
only, with Customize deferred until Layer 2 gave real choices — it now has them).
The devDependency offer remains future work; target-aware onboarding is built. The
mock below is illustrative:

```
  praxis — install the methodology layer
  Detected: existing repo · found CLAUDE.md · git present · stack: node, react

  ? How do you want to start?
  ❯ Quick start — recommended defaults, then preview the diff
    Customize — choose stacks, packages, and targets
    Cancel

  (Customize)
  ? Stacks:   [x] node  [x] react  [ ] python-backend
  ? Packages: [x] karpathy-claude  [x] wiki-memory  [x] session-handoff
              [x] upkeep  [x] instruction-upkeep  [x] safe-permissions
              [x] node-recipes  [x] node-testing  [x] react-components
              [x] react-testing  [ ] ponytail  [ ] drawio
  ? Targets:  [x] claude-code  [x] codex  [x] agents-md

  ── diff ───────────────────────────────────────────────
  + .claude/rules/   owned Claude Code rules
  + AGENTS.md        create
  + praxis.yaml      create
  + .agents/skills/  Codex workflows
  ────────────────────────────────────────────────────────
  ? Apply these changes? (Y/n)
```

## Stack: detect, then confirm (D5, multi-stack per D30/D33)

Stacks are **detected** from project files and pre-selected, but the user can
override them in Customize, so the committed value stays a user decision —
detection is a *proposal*, not a silent commitment. Detection is **multi-stack**:
`pyproject.toml`/`requirements.txt`/`setup.py` → `python-backend`; `package.json`
→ `node`; a `react` dependency → **both** `node` and `react` (React craft layers
on top of the general TS recipes). `detectContext` returns `detectedStacks:
Stack[]`; the chosen list is written to `praxis.yaml` `stacks`.

Targets are independently detected and always shown in an interactive
multiselect: `CLAUDE.md`/`.claude/`/`claude` → Claude Code;
`.codex/`/`.agents/skills/`/`codex` → Codex; existing `AGENTS.md` → generic
`agents-md`. With no signal, the legacy `claude-code + agents-md` recommendation
remains the fallback. Non-interactive initialization uses detection unless
repeatable `--target` overrides are supplied.

When both first-class targets are selected, onboarding maintains peer native
files rather than importing one into the other. Identical project facts sit in
one project-owned `praxis:shared-project` block per file; `check` compares those
blocks, while target-specific prose outside them remains independent (D48).

The Quick-start default is **data-driven** (`defaultManifest` over
`availablePackages()`): every Layer 1 package plus every Layer 2 package whose
`stack` is detected — so the easy install ships the full methodology, not a
Layer-1-only stub. Customization granularity is **whole packages** — not
rule-by-rule toggling. Coarse, coherent units keep `requires`/`conflicts`
enforceable and avoid "install half a thing."

## The manifest — `praxis.yaml` (D4, D6)

Visible at repo root, committed, hand-editable. The declarative half of the
model.

```yaml
# Edit this, then run `praxis sync`.
version: 1
methodology: "0.1.0"                 # pinned; `sync` offers to bump
stacks: [node, react]                # detection-seeded list, user-editable
targets: [claude-code, codex]        # which agent tools to support
packages:                            # Layer 1 + Layer 2 for the declared stacks
  - karpathy-claude                  # behavioral rules (Layer 1)
  - wiki-memory                      # the knowledge-wiki command (Layer 1)
  - react-components                 # Layer 2 craft (stack: react)
  - node-recipes                     # Layer 2 craft (stack: node)
  - ./praxis/packages/team-rules     # project-local package in this repo (D49)
```

Schema is validated with `zod`. Methodology version is pinned here so new
methodology reaches a repo only on an explicit `sync` that bumps it — never
behind the user's back (D6). `stacks` is **optional** and a **list** (D15/D30):
Layer 1 is stack-agnostic, so a repo installing only general methodology may
declare no stacks; the key appears only when Layer 2 recipes are
wanted, and a repo can be more than one stack at once (e.g. a React frontend with
a Node backend).

A `packages:` entry starting with `./` (or `../`) is a **project-local
package** — a package directory in this repo, resolved and emitted like any
shipped one (D49; see
[packages-and-emit](packages-and-emit.md#project-local-packages-d49)).
Customization stays *edit `praxis.yaml`, then sync*: the same single list, the
same whole-package granularity, one more place a package can come from.

## Workspace hubs (D53)

A repo can also be a **workspace hub**: a meta-repo with N independent git
repos ("members") cloned beneath it. The `workspace:` section can be
hand-added, or the init wizard will offer to scaffold it: when it detects two
or more sibling git repos nested under the repo root, a single confirm writes
the section from the detected members (members only — `edges` stay empty for
you to fill, and quick-start/`--yes` never add it):

```yaml
workspace:
  members:
    - path: node-api            # repo-relative dir this member is cloned into
    - path: frontend
      name: web                 # optional; defaults to basename(path)
  edges:
    - from: node-api             # producer
      to: web                    # consumer
      contract: docs/wiki/contracts/node-api-to-web.md  # optional; existence is advisory
```

`members` and `edges` are validated the same way the rest of the manifest is
(`zod`, `src/manifest.ts`): member paths must be repo-relative and must not
nest or overlap with each other; member names must be unique; an edge must
name only declared members. A `contract` page need not exist yet — an edge can
be declared before its page is written (declare-before-write bootstrap
order); `check` reports a missing one advisorially, never as a hard failure.

`workspace:` is not a member of `stacks:` — it **derives** a `workspace`
pseudo-stack the same way `stacks` gates any other Layer 2 package (D30),
just from section presence instead of a declared list; see
[packages-and-emit](packages-and-emit.md#workspace-package-d53) for the
package this gates and D53 for the full mechanism, including the `member:`
knowledge-anchor extension and the `/praxis-workspace-upkeep` command.

See [packages-and-emit](packages-and-emit.md) for how `packages` resolves to
files, and [merge-engine](merge-engine.md) for how `sync` reconciles changes.
