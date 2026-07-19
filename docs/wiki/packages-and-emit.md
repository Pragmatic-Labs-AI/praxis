---
praxisAnchors:
  - type: path
    target: src/packages.ts
  - type: path
    target: src/emit.ts
  - type: path
    target: conformance/packages.conformance.test.ts
  - type: path
    target: conformance/commands.conformance.test.ts
  - type: path
    target: src/plugins.ts
  - type: path
    target: conformance/plugins.conformance.test.ts
  - type: path
    target: conformance/local-packages.conformance.test.ts
  - type: path
    target: packages/layer2/node-recipes/rules.md
  - type: path
    target: packages/layer2/workspace/package.yaml
  - type: path
    target: conformance/workspace.conformance.test.ts
  - type: section
    target: docs/wiki/decisions.md#11-decision-record
---
# Packages, manifests, and emit

How methodology is packaged and turned into files. Canonical for the
package/manifest model; see [emitters](emitters.md) for the per-tool
emit contract (permission emitter, command emitter, `.claude/rules/` vs
`AGENTS.md` consumption). Decisions D16, D18–D25, D29, D30, D49, D53.

## Two layers

- **Layer 1 — general, stack-agnostic.** Behavioral rules that reduce common
  LLM coding failure modes (think before coding, simplicity first, surgical
  diffs, goal-driven execution). Curated payload — the differentiated core is
  the distribution machinery, not any content layer on its own
  ([orientation](orientation.md), D42).
- **Layer 2 — stack-specific, domain-agnostic.** Authoring recipes for "how to
  do X well in this stack," pointing at the user's own in-repo prior art for
  the concrete shape. All three planned stacks now ship — **`node`**
  (`node-recipes`, `node-testing`), **`python-backend`** (`python-backend-recipes`,
  `python-testing`), and **`react`** (`react-components`, `react-testing`); the
  `node` stack was built first and is dogfooded because Praxis is itself TS/Node,
  and Python/React mirror it as prior art (D30). Portable *craft* recipes travel;
  project *domain* recipes do not ship. Every bullet must be a *stack-specific*
  failure mode — generic craft lives in the file's intro prose, and a bold bullet
  title repeated across two stacks is a conformance failure (D51, extending D44's
  Layer-1-restatement guard).

## Package layout on disk (D16)

Packages live under `packages/<layer>/<pkg>/` at repo root:

```
packages/
  layer1/
    karpathy-claude/
      rules.md          # tool-neutral Layer 1 prose
    safe-permissions/
      permissions.yaml   # structured capability policy (D18/D19)
    instruction-upkeep/
      rules.md           # standing reminder to keep instructions current
      commands/          # workflow templates, one file per workflow (D22)
        audit.md
    session-handoff/     # context-cache handoff doc on session end (D24)
      rules.md
      commands/
        handoff.md       # /praxis-handoff
    wiki-memory/         # durable in-repo knowledge wiki (D25)
      rules.md
      commands/
        wiki.md          # /praxis-wiki
    upkeep/              # unified check+audit+wiki-lint entry point (D29)
      rules.md
      commands/
        upkeep.md        # /praxis-upkeep
  layer2/               # stack-specific recipes — FLAT, one dir per package (D30)
    node-recipes/       # stack: node — TS/Node authoring craft
      rules.md          # path-scoped (`paths:` frontmatter)
    node-testing/       # stack: node — unit-vs-integration test-layer recipe
      rules.md
    python-backend-recipes/  # stack: python-backend — Python authoring craft
      rules.md
    python-testing/     # stack: python-backend — pytest test-layer recipe
      rules.md
    react-components/   # stack: react — React component-authoring craft
      rules.md
    react-testing/      # stack: react — React Testing Library test-layer recipe
      rules.md
    workspace/          # stack: workspace (derived pseudo-stack, D53)
      rules.md          # sovereignty reminder
      commands/
        workspace-upkeep.md  # /praxis-workspace-upkeep
  external/             # thin plugin-marketplace packages (D28) — no methodology of their own
    ponytail/
      plugins.yaml       # target-gated Claude/Codex plugin metadata
    drawio/
      plugins.yaml
  decision/             # future: memory/, etc.
```

The **primary axis is layer** (not artifact type), so all parts of a package
stay together — rules, commands, and the package manifest live in one
directory. This makes the directory the unit of `requires`/`conflicts`
resolution and keeps "prior art is the template" navigable: the nearest
existing package is in the same subtree.

**Layer 2 is flat, not nested by stack (D30).** A package's stack is declared in
its `package.yaml` (`stack:` field), not encoded in its path — so
`packages/layer2/<pkg>/` keeps the same 2-level shape the scanner
(`availablePackages()`) already walks; no per-stack subdirectory and no scanner
change. Package names are globally unique, so stack-specific packages carry a
stack-naming convention (`node-recipes`, `node-testing`).

## The package model

A **package** is the unit Praxis distributes and composes. It carries a
`package.yaml`, loaded by `src/packages.ts`:

```yaml
name: wiki-memory       # MUST match the directory — self-identifying
layer: layer1
provides: [rules, commands]
# stack: node           # Layer 2 only — the stack this recipe targets (D30)
# requires: [...]       # other packages it depends on
# conflicts: [...]      # packages it can't coexist with
```

- **layer** — `layer1` | `layer2` | `decision` (e.g. a future
  `memory-decision`) | `external` (thin plugin-marketplace packages, D28) |
  `local` (project-local packages only, D49 — see below).
- **provides** — which artifact kinds the package contributes (below).
- **stack** — Layer 2 only: the target stack (`python-backend` | `node` |
  `react`). The package applies only when `praxis.yaml` `stacks` declares it
  (composition rule below, D30). Layer 1 / external packages omit it.
- **requires** — packages it depends on (a recipe pack *requires* the
  conformance harness; a recipe pointing at an uninstalled test is broken).
- **conflicts** — packages that can't coexist.

**`provides` drives emit (D20).** The emitter contributes exactly the
artifact kinds a package declares — it does not probe the filesystem and keep
whatever isn't undefined. The `name` must match the directory.

**A package can provide more than `rules.md` (D18).** The first concrete case
beyond prose is the permission policy: `safe-permissions` provides a
`permissions.yaml` (tool-neutral structured intent) instead of prose.
`loadPolicy(pkg)` scans `packages/*/<pkg>/permissions.yaml` the same way
`loadPackageSource` scans for `rules.md`. The emitter routes each artifact
kind to its delivery — see [the four artifact kinds](#the-four-artifact-kinds)
and [merge-engine](merge-engine.md) for how each is merged. `safe-permissions`
is included in the data-driven Layer 1 default; users can remove it in Customize
because it changes the agent's actual permissions, not just its instructions.

## The four artifact kinds

| Kind | Source file | Claude Code delivery | Codex delivery |
|---|---|---|---|
| `rules` | `rules.md` | owned `.claude/rules/praxis-<pkg>.md` | managed `AGENTS.md` block |
| `permissions` | `permissions.yaml` | merged `.claude/settings.json` | permission-profile TOML block + `.rules` file |
| `commands` | `commands/<name>.md` | `.claude/commands/praxis-<name>.md` → `/praxis-<name>` | `.agents/skills/praxis-<name>/SKILL.md` → `$praxis-<name>` |
| `plugins` | `plugins.yaml` | merged marketplace/enable settings | compatibility-gated repo marketplace entry |

`permissions` and `plugins` both target `.claude/settings.json`; the emitter
composes them into a **single `settings` write** per target (see
[emitters](emitters.md) and [merge-engine](merge-engine.md)). `plugins` packages
live in the `external` layer and ship no methodology prose of their own — they
declare plugin sources, which Praxis emits as inert target config (**no
shell-out**; the coding tool handles installation after trust).

**Tools with no model for a kind emit nothing** — a no-op target, never a
fabricated file (e.g. generic `agents-md` has no permission, command, or plugin
location). See [gotchas](gotchas.md).

## Composition rule (enforced by the loader)

A package applies only when its `requires` are satisfied. *Customize* means
"choose your packages," never "take the advisory half, drop the test." The
loader (`resolve()` in `src/packages.ts`) **refuses** — throws an
agent-actionable error — when a selected package names an unknown package,
requires a package not also selected, or conflicts with one that is.
**`requires` is satisfied only by another *selected* Praxis package (D21):**
not by auto-adding it (that would hide the dependency from the declarative
truth) and not by the user asserting "my repo already has it" (an
unverifiable claim is where enforcement quietly leaks).

**Stack composition (D30).** A Layer 2 package declaring a `stack` applies only
when `praxis.yaml` `stacks` includes that stack; `resolve()` (which takes the
declared `stacks`) throws the same agent-actionable error otherwise. This is the
same "a rule without its support is refused" shape as `requires`, applied to
stacks — a `react` recipe never lands in a repo that hasn't declared `react`.

**Second gating instance — a *derived* pseudo-stack (D53).** The package-side
`stack` enum (`src/packages.ts`) is wider than the manifest-side `STACKS` enum
(`src/manifest.ts`): it also admits `"workspace"`, a pseudo-stack a package can
target but a user can never write into `praxis.yaml` `stacks` directly — it is
**derived** from whether the manifest has a `workspace:` section (see
[interaction-model](interaction-model.md#workspace-hubs-d53)). `resolve()`
computes the declared-stacks set as `stacks ?? []` plus `"workspace"` when
`manifest.workspace` is present, then gates exactly like D30; a manifest that
tries `stacks: [workspace]` is rejected by the manifest schema itself before
`resolve()` is ever reached, and a `workspace`-stack package selected without a
`workspace:` section gets a workspace-specific refusal message (never the
generic "add X to `stacks`" advice, which would be a dead end here). One
source of truth, so gate and data can never drift.

## Project-local packages (D49)

A target repo can ship its **own** package — its team conventions as
methodology — without anything living in the Praxis install. A `./`- or
`../`-prefixed entry in `praxis.yaml` `packages:` is a package directory in
the target repo (convention: `praxis/packages/<pkg>/`, visible authored source
like `docs/`), resolved by `resolvePackages()` in `src/packages.ts` and
first-class from there on — same emit, sync, and prune paths as shipped
packages.

- **Same `package.yaml` schema, one constraint:** a local package must declare
  `layer: local` (fail-loud otherwise), keeping shipped-layer semantics
  unclaimable and provenance legible in the file itself. `provides`,
  `requires`, `conflicts`, `stack`, and `onboarding` all work unchanged — a
  local `onboarding:` hook rides the D36 bootstrap-delegation splice.
- **No shadowing:** a local package whose name collides with an installed one
  is a hard error (rename the directory). Collisions being impossible is what
  lets emitted ids stay uniform (`.claude/rules/praxis-<name>.md`, block id
  `<name>`) and the D46 prune machinery stay untouched — removing the `./`
  entry prunes the artifacts like any package removal.
- **The loader seam is the dir:** `ResolvedPackage.dir` is the single
  package-source abstraction; every content loader (`rules.md`, `commands/`,
  `permissions.yaml`, `plugins.yaml`) reads from the resolved dir rather than
  re-scanning the shipped tree by name.
- **No manifest schema change:** path entries are plain strings in `packages:`,
  so ordering (and therefore emit order) stays a single list, and customization
  remains "edit `praxis.yaml`, then sync."

Contract pinned by `conformance/local-packages.conformance.test.ts`
(resolution, `layer: local` enforcement, collision, full emit→drift→prune
lifecycle, D36 hook generality).

> **Loader now, ecosystem later.** v1 is a package format + a loader that
> composes *our own* packages, plus project-local packages in the target repo
> (D49). A registry, remote/git sources, and versioned third-party packages
> are a separate, framework-sized commitment — not built until the format is
> proven on our own packages.

## Workspace package (D53)

`packages/layer2/workspace/` ships the methodology for a **workspace hub** — a
meta-repo with independent git repos ("members") cloned beneath it, declared
in the hub's own `workspace:` manifest section (see
[interaction-model](interaction-model.md#workspace-hubs-d53)). Ordinary
package shape, gated on the derived `workspace` pseudo-stack above, and
`requires: [wiki-memory, upkeep, session-handoff]` (D21) — the command
delegates to all three rather than restating their steps:

```yaml
name: workspace
layer: layer2
stack: workspace
provides: [rules, commands]
requires: [wiki-memory, upkeep, session-handoff]
```

- **`rules.md`** — a standing reminder: cross-repo knowledge lives in the
  hub's own wiki, never duplicated into a member's; trigger
  `/praxis-workspace-upkeep` after any cross-repo-impacting change. Its
  always-loaded planning trigger also enters that workflow before finalizing a
  cross-member plan, fans one read-only workstream into each affected cloned
  member, and requires member-local harness, source, test, and `file:line`
  evidence rather than inferring implementation from hub prose — the delegate
  reads that member's `CLAUDE.md` and every file under `.claude/rules/`
  (Claude Code) or `AGENTS.md` (Codex/agents-md), plus `docs/wiki/index.md`
  and its linked pages when present, before inspecting source. A member's
  files are never edited from the hub uninvited (sovereignty). Claude Code
  receives this rule in `.claude/rules/praxis-workspace.md`; Codex receives
  the equivalent managed `workspace` block in `AGENTS.md`.
- **`commands/workspace-upkeep.md`** (`/praxis-workspace-upkeep`) —
  hub-sovereign upkeep: run the hub's own `{{workflow:praxis-upkeep}}` →
  keep the hub wiki's cross-repo system-map current (member table, edges,
  contract-page index, add-a-member checklist), anchored with `member:`
  anchors so drift trips `check` → fan out **report-first** to each cloned
  member via a `{{workflow:praxis-handoff}}` brief, executed in **audit-only**
  mode (propose, never apply). A **planning entry** — reached via the rule's
  planning trigger or a planning/implementation-question argument — scopes
  the member fan-out to only the affected cloned members instead of the full
  roster, treats hub-drift and wiki-currency as optional observations, and
  collapses the staleness judgment and consolidated report into a single
  planning synthesis (constraints, validation commands, risks, `file:line`
  evidence); the entire pass runs **read-only** in that mode, so no `sync`,
  wiki edit, or instruction edit applies until the user is out of planning and
  confirms (this closes a conflict with Claude Code's plan mode, which blocks
  writes). Every brief resolves the member root, starts the delegate there,
  and has it read that member's `CLAUDE.md` and every file under
  `.claude/rules/` (Claude Code) or `AGENTS.md` (Codex/agents-md), plus its
  wiki entrypoint. For planning or implementation questions, the delegate
  inspects relevant source and nearest tests with `file:line` evidence instead
  of stopping at methodology currency. Outside planning entry, the workflow
  then judges edge-based staleness (Tier-3: a member changed since its
  producer edge's contract page was last touched flags the consumer as
  *likely stale*) → one consolidated report, applying a member's edits only
  on that user's explicit confirmation. Every direct hub/member check carries
  D40's CLI resolution forward: use an available local `praxis` command,
  otherwise continue with `npx @pragmatic-labs/praxis@latest` (never an
  unpinned npx spec); conformance pins the planning entry's affected-member
  scope and read-only guarantee, plus the enumerated instruction surfaces, in
  the Claude Code and Codex renderings so permission metadata alone cannot
  masquerade as executable workflow behavior.

This is the second package (after `wiki-memory`) whose command orchestrates a
cross-repo/multi-agent workflow, but the workflow itself is **prose, not
harness** — D12 holds (Praxis never calls an LLM); the deterministic teeth are
the manifest schema, the anchor `member:` resolution, and the stack gate
above, pinned by `conformance/workspace.conformance.test.ts`. Praxis itself
does not dogfood this package (it isn't a workspace); that conformance
fixture is the substitute for `selfcheck` here.

## Adding a package — mirror prior art

There is **no scaffold generator and never will be** (CLAUDE.md). To add a
package, read the closest existing one and mirror it; the conformance tests
catch deviations. The four commands packages (`instruction-upkeep`,
`session-handoff`, `wiki-memory`, `upkeep`) are near-identical templates: a
`package.yaml`, a `rules.md` standing reminder, and `commands/<name>.md`.

**Every new package/emitter ships with a conformance test** (harness-before-
features). `conformance/commands.conformance.test.ts` is **data-driven** — it
asserts the command invariants for *every* `provides: [commands]` package, so
a new commands package is covered without editing the test (D24).

See [workflows](workflows.md) for the test/CI commands.
