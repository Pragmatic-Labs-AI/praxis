---
praxisAnchors:
  - type: path
    target: CLAUDE.md
  - type: path
    target: AGENTS.md
  - type: path
    target: docs/wiki/packages-and-emit.md
  - type: path
    target: docs/wiki/emitters.md
  - type: path
    target: docs/wiki/gotchas.md
  - type: path
    target: docs/wiki/interaction-model.md
  - type: path
    target: docs/wiki/decisions.md
  - type: section
    target: docs/wiki/decisions.md#11-decision-record
---
# Glossary

Praxis's project-specific vocabulary, defined in one place so a term that means
something particular here is not reverse-engineered from context every session.
Each entry defines the term and cites its canonical home; the cited source wins
on any conflict — fix the glossary, not the source.

## Anchor (`praxisAnchors`)

Machine-checkable frontmatter on a knowledge page asserting a fact about the repo
that the page depends on. Three deterministic kinds: `path` (a file/dir exists),
`command` (an `npm` script exists), `section` (a `docs/file.md#heading-slug`
resolves). `praxis check` hard-fails a broken anchor; staleness tripwires remain
advisory future work. See [decisions.md](decisions.md) D27, and the wiki-memory
rule in [.claude/rules](../../.claude/rules/praxis-wiki-memory.md) or its
managed [`AGENTS.md`](../../AGENTS.md) counterpart.

## Conformance / conformance test

The CI-gated test suite (under `conformance/`, run by `npm run conformance`) that
verifies emitted output and methodology invariants — not "does the agent follow
the rules" but "does the output match the contract." A rule that matters has a
conformance test; a new package or emitter ships with one (harness-before-features).
See [workflows.md](workflows.md) and [packages-and-emit.md](packages-and-emit.md#adding-a-package--mirror-prior-art).

## Decision recipe

A Layer 2 package that ships *guidance for making a choice* — e.g. whether a
project needs a runtime memory backend and how to choose among options — rather
than installing the thing chosen. The recipe is methodology; the backend is
implementation Praxis never installs. See [decisions.md](decisions.md) D25 and
the memory entry below.

## Emitter

The component that translates the singular, tool-neutral methodology source into
per-tool output files (Claude Code, OpenAI Codex, and the generic `agents-md`
flat-file convention today; Cursor planned). A tool with no model for an artifact kind emits nothing — a
no-op, never a fabricated file. See [emitters.md](emitters.md); decisions D19
(permissions), D22 (commands), and D28 (plugins).

## External package (plugin marketplace)

A thin package in the `external` layer (`packages/external/<pkg>/`) that ships no
methodology prose of its own — it declares plugin marketplace metadata in
`plugins.yaml`, the fourth artifact kind (`provides: [plugins]`). Praxis emits
inert Claude Code `extraKnownMarketplaces` + `enabledPlugins` settings and, only
for explicitly verified packages, a pinned Codex marketplace entry; **it never
executes anything**. Ponytail supports both targets, while Draw.io remains
Claude-only. See [emitters.md](emitters.md#plugin-marketplace-emitter-d28);
decisions D28 and D47.

## Harness

The enforcement skeleton that makes a rule real: conformance tests, the CI gate,
and the prior-art-as-template convention — plus, since D26/D27, the PR-time
currency gate (`praxis check`) that hard-fails derived drift and broken anchors.
"Harness before features" is the rule that none of this lands after the feature
code it guards. See the shared non-negotiables in
[CLAUDE.md](../../CLAUDE.md) / [AGENTS.md](../../AGENTS.md) and
[decisions.md](decisions.md) D26.

## Layer 1

General, stack-agnostic behavioral rules that reduce common LLM coding failure
modes (think before coding, simplicity first, surgical diffs, goal-driven
execution). Curated and tool-neutral. See [packages-and-emit.md](packages-and-emit.md#two-layers).

## Layer 2 (recipe)

Stack-specific, domain-agnostic authoring recipes — "how to do X well in this
stack," pointing at the user's own in-repo prior art for the concrete shape.
Portable *craft* recipes travel; project *domain* recipes do not ship. All three
target stacks — Python backend, Node, and React — ship recipe packages; only the
`node` stack is dogfooded on Praxis itself. A Layer 2 package declares its
[stack](#stack--stacks) in `package.yaml` and lives flat at
`packages/layer2/<pkg>/`. See
[packages-and-emit.md](packages-and-emit.md#two-layers); decision D30.

## Manifest (`praxis.yaml`)

The visible, committed, hand-editable file recording which packages a repo has
installed and at what pinned version — the declarative truth that `praxis sync`
reads and writes. Praxis self-hosts its own `praxis.yaml`. [`stacks`](#stack--stacks)
is an optional list (set only when Layer 2 recipes are wanted). See
[interaction-model.md](interaction-model.md); decisions D4, D6, D15, D30.

## Memory

In Praxis, *memory* always means the **AI coding tool's memory of its interactions
with the user** — the curated, file-based instruction layer the agent loads at
session start (`CLAUDE.md` or `AGENTS.md`, `MEMORY.md`/`USER.md`, skills,
decision notes, the knowledge wiki). That curated surface is part of the
methodology layer Praxis installs and syncs.

It does **not** mean a runtime memory system for the *target application* (Mem0,
Zep, Letta, Graphiti, etc.). Wiring a persistence backend into the user's app is
implementation — out of scope. The most Praxis ships on that topic is a
[decision recipe](#decision-recipe). See [gotchas.md](gotchas.md); decisions D8
and D25.

## Methodology layer

What Praxis installs: the meta-development rules and authoring recipes that make
AI coding agents produce correct, conformant work — agent instructions, native
workflows, methodology permissions and plugin metadata, and Praxis's own
manifest. It is **not** implementation scaffolding, an application config
generator, or a wired-in runtime; Praxis never modifies the target project's
application code, dependencies, or runtime infrastructure. See
[CLAUDE.md](../../CLAUDE.md) / [AGENTS.md](../../AGENTS.md).

## Package

The unit Praxis distributes and composes, living at `packages/<layer>/<pkg>/`
with a `package.yaml` (`name`/`layer`/`provides`/`requires`/`conflicts`, plus an
optional [`stack`](#stack--stacks) for Layer 2). `provides` *drives* emit
(declared, not probed); `requires` is satisfied only by another selected
package; an unknown name fails loudly. See
[packages-and-emit.md](packages-and-emit.md#the-package-model); decisions D16, D20, D30.

## Project-local package

A [package](#package) that lives in the **target repo itself**, not in the
Praxis install — declared as a `./`- or `../`-prefixed path entry in
[`praxis.yaml`](#manifest-praxisyaml) `packages:` (convention:
`praxis/packages/<pkg>/`) and resolved/emitted/synced/pruned first-class like a
shipped one. It must declare `layer: local`; a name colliding with an installed
package is a hard error (no shadowing). This is how a team ships *its own*
conventions as methodology — e.g. the package the `capture-codebase-patterns`
skill generates. Distinct from an [external package](#external-package-plugin-marketplace),
which ships *inside* Praxis and only declares plugin metadata. See
[packages-and-emit.md](packages-and-emit.md#project-local-packages-d49); decisions D49, D50.

## Prior art is the template

The rule that replaces a scaffold generator: to add something, read the closest
existing example in the repo and mirror it; the conformance tests catch
deviations. This shifts the burden from "did the agent follow the rules"
(drift-prone) to "did the agent mirror the prior art" (verifiable). There is no
generator and there will not be one. See [CLAUDE.md](../../CLAUDE.md) /
[AGENTS.md](../../AGENTS.md) and
[packages-and-emit.md](packages-and-emit.md#adding-a-package--mirror-prior-art).

## Stack / `stacks`

The technology a repo's [Layer 2](#layer-2-recipe) recipes target —
`python-backend`, `node`, or `react`. Declared in the manifest as **`stacks`**,
an optional *list* (a repo can be more than one stack at once, e.g. a React
frontend with a Node backend); the field is absent for Layer-1-only repos. A
Layer 2 [package](#package) names its single target stack in `package.yaml`
(`stack:`) and applies only when the manifest's `stacks` includes it (the
composition rule). Distinct from a [tool target](#target). See
[packages-and-emit.md](packages-and-emit.md#composition-rule-enforced-by-the-loader);
decisions D15, D30.

## Target

The thing methodology is emitted *for* or installed *into*. Two senses: a **tool
target** (Claude Code, OpenAI Codex, generic `agents-md`; Cursor planned) that
an emitter produces variants for, and the **target project** — the user's
repository that receives the methodology layer. Praxis (TypeScript/Node) is
distinct from the [stacks](#stack--stacks) its Layer 2 recipes target (Node,
Python backend, and React all ship; only Node is dogfooded here). See
[emitters.md](emitters.md) and [CLAUDE.md](../../CLAUDE.md) /
[AGENTS.md](../../AGENTS.md).
