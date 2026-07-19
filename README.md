# Praxis

[![CI](https://github.com/Pragmatic-Labs-AI/praxis/actions/workflows/ci.yml/badge.svg)](https://github.com/Pragmatic-Labs-AI/praxis/actions/workflows/ci.yml)

Agent instruction files rot like documentation — `CLAUDE.md`, `AGENTS.md`,
rules, skills drift from what the codebase actually does, and nothing catches
it until an agent acts on stale guidance. **Praxis makes the instruction layer
versioned, pinned, drift-checked, and CI-gated**, across multiple agent tools,
from one neutral source. Other tools generate agent instructions once; Praxis
manages them the way Renovate/Dependabot manage dependencies — and `praxis
check` fails your build the moment the installed files stop matching the
pinned methodology.

Praxis is **not** implementation scaffolding and **not** an application config
generator. It writes _only_ the methodology layer — agent instructions,
native workflows, methodology permissions and plugin metadata, and its own
manifest. It never touches your application code, dependencies, or runtime
infrastructure.

```bash
npx @pragmatic-labs/praxis
```

## Why it's different

- **Versioned, pinned, drift-checked.** Methodology ships as composable
  packages pinned in a committed `praxis.yaml`. `praxis check` reports drift
  and exits non-zero, so CI catches an agent instruction file that's been
  hand-edited out of sync with what's pinned.
- **A composition/merge step, not a template stamp.** Installing or syncing
  methodology folds it into an _existing_ project without clobbering your own
  content: an edit inside a managed block is treated as a conflict to
  reconcile, never silently overwritten.
- **One neutral source, per-tool outputs.** Claude Code and OpenAI Codex are
  both first-class targets, plus a generic `agents-md` convention for any
  other tool — one methodology source, native surfaces per tool, neither
  target depending on the other at runtime.
- **The manifest is the truth, not a side effect.** `praxis.yaml` is plain,
  committed YAML you can read and hand-edit; every run's outcome is legible
  there, not hidden in a database or a cache.

The curated content that ships on top of this — Layer 1 behavioral rules and
Layer 2 stack recipes, below — is the starting payload and the credibility
demo for the machinery, not the differentiator itself.

## What it does

Running `praxis` in a project:

1. **Detects your stack** from project files — `pyproject.toml` /
   `requirements.txt` / `setup.py` → `python-backend`; `package.json` → `node`;
   a `react` dependency → both `node` and `react`.
2. **Offers a first-run fork** — _Quick start_ (recommended defaults, preview
   the diff, confirm) or _Customize_ (choose stacks, packages, and targets).
3. **Composes the methodology into your repo** — it emits Claude Code rules,
   Codex skills, and managed `AGENTS.md` blocks without clobbering your own
   content, and records what it did in a visible, committed, hand-editable
   manifest: `praxis.yaml`.

It always previews a single diff before writing. Git is your undo.

## The two layers

- **Layer 1 (general, stack-agnostic).** Tool-neutral behavioral rules that
  reduce common LLM coding mistakes, plus methodology-upkeep commands:
  `karpathy-claude`, `wiki-memory`, `session-handoff`, `upkeep`,
  `instruction-upkeep`, `safe-permissions`.
- **Layer 2 (stack-specific recipes).** Authoring recipes for the stack you're
  on — `node` (`node-recipes`, `node-testing`), `python-backend`
  (`python-backend-recipes`, `python-testing`), and `react`
  (`react-components`, `react-testing`).

## The mental model — imperative entry, declarative truth

This is the `npm install` pattern. One command (`praxis`) does the smart thing
immediately and records the result in `praxis.yaml`. Thereafter the manifest is
the source of truth: to customize, **edit `praxis.yaml`, then run `praxis
sync`**. There is no `add`/`remove` — one obvious way to change things.

```yaml
# Edit this, then run `praxis sync`.
version: 1
methodology: "0.1.0"                 # pinned; `sync` offers to bump
stacks: [node, react]                # detection-seeded, user-editable
targets: [claude-code, codex]        # which agent tools to support
packages:
  - karpathy-claude                  # behavioral rules (Layer 1)
  - wiki-memory                      # the knowledge-wiki command (Layer 1)
  - node-recipes                     # Layer 2 craft (stack: node)
  - react-components                 # Layer 2 craft (stack: react)
```

New methodology only reaches your repo on an explicit `sync` that bumps the
pinned version — never behind your back. `praxis check` is the read-only
counterpart: it reports the same drift for CI without writing anything.

## Multi-tool by construction

The methodology source is singular; Praxis _emits_ per-tool variants from it.
**Claude Code** (`.claude/rules/`, commands, `settings.json`), **OpenAI Codex**
(`AGENTS.md`, `.agents/skills/`, permission profiles/rules, plugin
marketplace), and the generic **`agents-md`** flat-file convention are built
today. When Claude Code and Codex both target a repo, their shared project
facts stay in parity and `praxis check` verifies it. Cursor is a planned
target; Copilot/Windsurf/Roo are deferred until they land.

## Workspace hubs (synthetic monorepos)

A repo can be a **workspace hub** over N independent git repos cloned beneath
it, each still its own standalone checkout with its own CI: add a
`workspace:` section to the hub's `praxis.yaml` (by hand, or let the init
wizard scaffold it when it sees nested repos) to get `/praxis-workspace-upkeep`
— a hub-sovereign pass that keeps the hub's cross-repo wiki current and
report-only-audits each member.

## Commands

| Command        | What it does                                                                 |
|----------------|--------------------------------------------------------------------------------|
| `praxis`       | First-run wizard; apply.                                                      |
| `praxis sync`  | Reconcile the repo to `praxis.yaml`; offer newer methodology; diff + confirm. |
| `praxis check` | Dry-run; report drift; non-zero exit for CI.                                  |

`--yes` skips prompts for non-interactive/CI use. Repeat `--target`, for example
`praxis --yes --target codex --target agents-md`, to override target detection.

## Security posture

Consumer-repo writes are containment-checked against path/symlink escape,
shipped plugin sources are pinned to full commit SHAs, and the published
package ships an `npm-shrinkwrap.json` for a locked dependency tree. See
[`SECURITY.md`](SECURITY.md) for scope and reporting.

## "Memory" means the agent's memory, not the app's

In Praxis, _memory_ always refers to the **AI coding tool's** curated,
file-based instruction layer (`CLAUDE.md` or `AGENTS.md`, the knowledge wiki,
skills, decision notes) — not a runtime memory backend for your application
(Mem0, Zep, Letta, etc.). Wiring a persistence backend into your app is
implementation, and out of scope. The most Praxis ships on that topic is a
Layer 2 _decision recipe_: guidance on whether you need runtime memory and how
to choose — never the backend itself.

## Developing Praxis

Praxis is a TypeScript/Node CLI, and it self-hosts: it installs its own
methodology and gates drift in its own CI.

```bash
npm run typecheck    # tsc --noEmit
npm run build        # tsc → dist/
npm test             # vitest over test/
npm run conformance  # vitest over conformance/
npm run selfcheck    # praxis check against this repo's emitted files
```

CI runs all five, in that order, on every push to `main` and every PR. Work
lands on a feature branch and merges via PR — no direct pushes to `main`.

- `src/` — CLI implementation (emit, sync, merge, manifest, packages,
  permissions, plugins, anchors, init).
- `packages/<layer>/<pkg>/` — methodology source (`layer1/`, `layer2/`, plus
  thin `external/` plugin-marketplace packages).
- `test/` — unit tests mirroring `src/`. `conformance/` — the CI-gated
  conformance suite.
- `docs/wiki/` — the durable, in-repo knowledge wiki and canonical design doc;
  start at [`docs/wiki/index.md`](docs/wiki/index.md).

See the peer-native [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md) for
the project's non-negotiable rails.
