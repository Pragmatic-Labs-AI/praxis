---
praxisAnchors:
  - type: path
    target: src/emit.ts
  - type: path
    target: src/permissions.ts
  - type: path
    target: conformance/emit.conformance.test.ts
  - type: path
    target: conformance/permissions.conformance.test.ts
  - type: path
    target: conformance/commands.conformance.test.ts
  - type: path
    target: src/codex-security.ts
  - type: path
    target: src/codex-marketplace.ts
  - type: path
    target: conformance/codex.conformance.test.ts
  - type: section
    target: docs/wiki/decisions.md#11-decision-record
---
# Emitters (tool-neutrality)

One methodology source → per-tool outputs (Claude Code, OpenAI Codex, and generic AGENTS.md).
Every emitter ships with a conformance test that the output is valid for that
tool. Adding an emitter goes through `skills/add-emitter/SKILL.md` (planned —
see [roadmap](roadmap.md)) and mirrors the closest existing emitter; until it
exists, follow "prior art is the template" by hand.

Claude Code and Codex get tool-specific surfaces (permissions, commands/skills,
and marketplaces) — these stay **quarantined per-tool** so
the neutral core never depends on them. See
[packages-and-emit](packages-and-emit.md) for the artifact kinds an emitter
routes (`rules`, `permissions`, `commands`, `plugins`) and
[merge-engine](merge-engine.md) for how each is merged into a target file.

## Permission emitter (D19)

Permissions are inherently per-tool config, so the source stays neutral and
the *artifact* is tool-specific. The `safe-permissions` package's
`permissions.yaml` lists semantic **capabilities** (`read-repo`, `git-push`,
`read-secrets`, …) in `allow`/`ask`/`deny` buckets — never raw rule strings,
which would bind the source to one tool. The vocabulary is **closed** (a zod
enum in `src/permissions.ts`): a policy may only name capabilities every
emitter can translate, so nothing is silently dropped. Each emitter owns its
capability→rule mapping:

- **Claude Code** (first): `CLAUDE_CODE_RULES` in `src/emit.ts` maps each
  capability to concrete `Tool(pattern)` rule strings (grammar verified
  against `code.claude.com/docs/en/settings`), written to
  `.claude/settings.json` via the JSON merge. `deny` overrides `allow`, so
  `Read(./.env)` stays denied under a broad `Read(./**)` allow.
- **Codex (0.138+)**: a hash-protected block in `.codex/config.toml` selects a
  Praxis profile extending `:workspace`, denies secret-file globs, and leaves
  sandbox network access disabled. `.codex/rules/praxis-safe-permissions.rules`
  maps command capabilities to `allow`, `prompt`, and `forbidden`. TOML and
  command-rule reconciliation are independent, so a profile conflict does not
  suppress a valid rules file. Project Codex config loads only after repo trust.
- **Tools with no permission model emit nothing** — a no-op target, never a
  fabricated file. `agents-md` (a flat-file standard) emits no permissions.
  Cursor *does* have a model (`permissions.json` with allowlists/`autoRun`)
  and is a future emitter target; Copilot/Windsurf/Roo are deferred until
  each lands.

Default posture is **allow-common-dev / smooth**: allow routine local dev
(read/edit, dev scripts, read-only git, local commit), `ask` before anything
outward or dependency-mutating (push, installs), `deny`
destructive/exfiltration (`rm -rf`, force-push, reading secrets, global
installs). `pipe-network-to-shell` (`curl … | sh`) is deliberately **not** a
capability: prefix-matched rules cannot reliably catch a pipe, and a
denylist that looks protective but isn't is worse than none — excluded by
the content bar rather than emitted as a false guarantee.

## Command emitter (D22)

Workflows are a content package's **third artifact kind** (after
`rules.md` and `permissions.yaml`): `commands/<name>.md` files under
`packages/<layer>/<pkg>/commands/`. Each file is a neutral template. Invocation,
argument, and shell-expansion placeholders are rendered per target. The filename is the
command's name; the emitter prefixes it on write so the managed file is
identifiable: `<name>.md` → `.claude/commands/praxis-<name>.md`, an **owned**
file (whole-file place/replace, same delivery as `.claude/rules/*.md`).

- **Claude Code**: owned `.claude/commands/praxis-<name>.md`,
  auto-discovered and invoked as `/praxis-<name>`.
- **Codex**: owned `.agents/skills/praxis-<name>/SKILL.md` with only the required
  `name` and `description` frontmatter, invoked as `$praxis-<name>`.
- **Tools with no command model emit nothing** — same no-op rule as the
  permission emitter (D19). `agents-md` (a flat-file standard) has no
  command location, so a commands package contributes nothing to it.

First package: `instruction-upkeep`, whose `/praxis-instructions` command
operationalizes the instruction-upkeep rule as a user-invocable workflow
rather than prose the agent merely reads. Opt-in, like `safe-permissions`:
not in `init`'s default package set.

## Plugin-marketplace emitter (D28)

A **fourth artifact kind**, `plugins`, lets a thin `external`-layer package
declare target-compatible plugin metadata instead of authoring methodology. The
source is `packages/external/<pkg>/plugins.yaml` (`src/plugins.ts`, mirroring
`src/permissions.ts`): a `marketplace` (name + `github`/git source, optionally
pinned with `ref`) and an `enable[]` list. The loader **fails loud** if an
`enable` entry's `@<marketplace>` doesn't match the declared marketplace name.

- **Claude Code**: emitted into `.claude/settings.json` as
  `extraKnownMarketplaces` (the marketplace source) + `enabledPlugins` (the
  enabled list), via the same JSON merge as permissions. **Praxis never executes
  anything** — the marketplace reference is committable, inert config that Claude
  Code itself reads on folder-trust to offer install/enable. This keeps Praxis
  deterministic and offline at sync (D12) and replaces an earlier, never-merged
  "run an npx/git installer" exploration.
- **Codex**: only packages with explicit, verified `codex` metadata emit into
  `.agents/plugins/marketplace.json`. Git-root and `git-subdir` sources preserve
  pins and default selected packages to `INSTALLED_BY_DEFAULT` / `ON_INSTALL`.
  `.praxis/codex-marketplace-state.json` records hashes of owned entries, so user
  entries and ordering survive while edited owned entries become conflicts.
  Ponytail v4.7.0 qualifies; Draw.io remains Claude-only.
- **Tools with no plugin model emit nothing** — same no-op rule as the
  permission (D19) and command (D22) emitters. `agents-md` has no plugin
  location, so a `plugins` package contributes nothing to it.

`permissions` and `plugins` both write `.claude/settings.json`, so `src/emit.ts`
emits **one** `settings` EmitOp per target carrying whichever of rules/plugins
apply — two packages on the same file compose into a single write rather than two
ops racing on the path. See [merge-engine](merge-engine.md) for the
`reconcileSettings` single-pass reconciler. First external packages: `ponytail`
(pinned at `v4.7.0`) and `drawio`, dogfooded in Praxis's own `praxis.yaml`.

## Per-tool consumption: `.claude/rules/` vs `AGENTS.md` (verified)

Three targets, different consumers — documented here so the split isn't
mistaken for a bug:

- **`claude-code`** → owned `.claude/rules/praxis-<pkg>.md`. Per
  `code.claude.com/docs/en/memory`: "Rules without `paths` frontmatter are
  loaded at launch with the same priority as `.claude/CLAUDE.md`." Our owned
  files carry no `paths` frontmatter, so they load unconditionally every
  session. Confirmed live in this repo's own session: the file's exact prose
  appeared in context at session start, alongside `CLAUDE.md` — not merely
  "should load per the docs" but observed loading.
- **`agents-md`** → managed block in `AGENTS.md`. Per the same doc: "Claude
  Code reads `CLAUDE.md`, not `AGENTS.md`." So in Praxis's own repo, the
  emitted `AGENTS.md` is **not** read by Claude Code at all — it exists for
  other tools (Cursor, Copilot, etc.) that follow the AGENTS.md convention.
  This is by design, not a gap: a Claude-only manifest has no reason to
  select `agents-md`, since nothing here would consume it. Praxis never imports
  `AGENTS.md` into `CLAUDE.md`; dual first-class installs keep project-owned
  shared facts in peer native blocks instead (D48), avoiding duplicate
  methodology while leaving both files usable without Praxis.
- **`codex`** → the same managed `AGENTS.md` destination plus native skills and
  security/plugin surfaces. Codex scopes instructions by directory hierarchy,
  not YAML path globs, so Layer 2 `paths` frontmatter becomes an explicit
  applicability sentence. Selecting `codex` with `agents-md` coalesces into one
  block operation—never duplicate blocks or competing writes.
- **No markers in owned files.** Block delivery (`AGENTS.md`) wraps content
  in `praxis:begin`/`praxis:end` HTML comments because it edits *inside* a
  user-owned file and needs a managed region. Owned delivery
  (`.claude/rules/*.md`) replaces the *whole* file, so there is nothing to
  delimit — markers there would be inert noise Claude has to read past. The
  source is shipped as pure prose; verified by the "no praxis:begin markers"
  conformance test in `emit.conformance.test.ts`, and by
  `grep -rn "praxis:begin" .claude/rules/` returning nothing in this repo.
- **What's testable vs not.** Conformance tests prove the file is
  well-formed and at the path Claude Code auto-loads. They cannot prove the
  model *obeys* the rule's content — that's a property of the model, not the
  file, and isn't unit-testable. The `InstructionsLoaded` hook (fires on
  every `CLAUDE.md` / `.claude/rules/*.md` load, with
  `file_path`/`memory_type`/`load_reason`) is an optional observability
  mechanism a user could wire up to audit loads over time; Praxis doesn't
  ship it by default since it's operational config, not methodology
  (CLAUDE.md "content inclusion bar").

See [gotchas](gotchas.md) for the compressed, trap-focused version of the
AGENTS.md and no-markers points above.
