<!-- praxis:shared-project begin -->
# Praxis

**Status:** the methodology harness plus first-class Claude Code and OpenAI Codex targets (and the generic `agents-md` convention) are on `main`. Latest: **methodology-pin hardening** (D59/D60/D61) — `methodology:` in `praxis.yaml` is now resolved and enforced against the running CLI's own version (exact-match, fail-loud in either direction — a stale pin or a stale CLI both error with guidance to reconcile them); `praxis init` stamps the running version at scaffold time and the old `METHODOLOGY_VERSION` constant is retired, and interactive `sync` now offers a confirm-to-bump prompt on an upgrade-available pin (`check`/`sync --yes`/non-interactive still fail loud, never prompting); `README.md` documents a reproducible consumer-CI pin (exact devDependency + lockfile + `npm ci` + bin invocation, never a bare `npx`, docs-only, no source change); and `sync` writes through a plan → stage → verify → commit boundary spanning all five passes (main ops, block-orphan sweep, Codex-config reconcile, marketplace prune, owned-file orphans) with external-change detection, so a mid-run crash can no longer land partial methodology (a durable rollback journal remains deferred). Earlier: **launch prep** (D58) — the in-repo half of the org migration: the package is now **`@pragmatic-labs/praxis`** (0.1.17, same 0.x line), the Node floor is `>=22.12.0` (CI on Node 22), the public-snapshot builder emits a signed-off `main` root commit under a pinned public identity, the boundary sweep is genuinely case-insensitive and offline-safe, and the one-time npm first-publish bootstrap is recorded (trusted publishing binds only to an already-existing package); **OSS-launch hardening** — consumer-repo path/symlink containment and full-SHA-pinned plugin sources (D54/D55), plus the public-boundary pipeline and the release boundary (D56/D57); the **workspace tier** (D53); **project-local packages** (D49). Praxis remains an npx-publishable TypeScript/Node CLI; see `docs/wiki/decisions.md` for the decision ledger and `docs/wiki/index.md` for the durable project map.

Praxis installs a **methodology layer** into a codebase: durable behavioral rules, authoring recipes, native workflows, and tool-specific methodology configuration for AI coding agents. It is not application scaffolding and never installs target-project runtime infrastructure.

## Working in this repo

- **Build/test/run:** `npm run typecheck`, `npm run build`, `npm test`, `npm run conformance`, then `npm run selfcheck`. CI runs those five gates in that order on every pull request and push to `main`.
- **Layout:** `src/` contains the CLI implementation; `packages/<layer>/<pkg>/` contains methodology sources; `test/` contains unit tests; `conformance/` contains cross-cutting contracts; `scripts/` holds build-time tooling (the public-snapshot builder and boundary sweep); `examples/fresh-app/` is input data and must never be initialized in place; `praxis.yaml` is the self-hosting manifest; `docs/wiki/` is the canonical durable design record; `docs/public/` defines the public-snapshot allowlist and curated wiki overrides.
- **Convention:** work on a feature branch and merge through a green pull request—never push directly to `main`; sign off every commit (`git commit -s`, enforced by the DCO gate). A new package, emitter, or invariant ships with a test at the layer that enforces it. `CONTRIBUTING.md` is the canonical contribution guide.
- **Always do:** read `docs/wiki/index.md` before structural work; mirror the nearest prior art; keep changes surgical; run the full gate above; run the Praxis upkeep workflow when work changes or exposes drift in instructions, generated agent files, or durable wiki knowledge.

## Non-negotiables

- **Harness before features.** A rule that matters has a test; prose alone is not enforcement.
- **Methodology, not implementation.** Praxis may write native agent instructions, skills, permission configuration, and plugin metadata, but never application code, dependencies, or runtime infrastructure.
- **Tool-neutral by construction.** One neutral methodology source emits native Claude Code and Codex surfaces plus the generic `agents-md` convention. Tool-specific behavior stays quarantined in its emitter. Every emitter change ships with a check that the output is valid for that tool, run in CI — neutrality is verified, not assumed.
- **Content inclusion bar.** Content must be durable across model releases, vendor-neutral or explicitly target-specific, verified against official documentation, and part of the methodology layer.
- **Promote reusable lessons.** Improvements useful to every Praxis project belong in the shipped methodology, not only this repository’s local instructions or wiki.
<!-- praxis:shared-project end -->

## "Memory" means the agent's memory, not the app's

A recurring source of misunderstanding, fixed here. In Praxis, *memory* always refers to the **AI coding tool's memory of its interactions with the user** — the curated, file-based instruction layer the agent loads at session start (`CLAUDE.md`, `MEMORY.md`/`USER.md`, skills, decision notes). That curated surface is part of the methodology layer Praxis installs and syncs.

It does **not** mean a runtime memory system for the *target application* (Mem0, Zep, Letta, Graphiti, etc.). Wiring a persistence backend into the user's app is implementation — out of scope per *Methodology, not implementation* above. The most Praxis ships on that topic is a Layer 2 **decision recipe**: guidance on whether a project needs runtime memory and how to choose among the options. Praxis installs the recipe; it never installs the backend.

## Prior art is the template

There is no scaffold generator and there will not be one. To add something, read the closest existing example in this repo and mirror it; the conformance tests catch deviations. This shifts the burden from "did the agent follow the rules" (drift-prone) to "did the agent mirror the prior art" (verifiable).

## Authoring (not yet built)

The intent is for adding anything new to go through a skill that names the prior-art file and the conformance test that enforces correctness. These skills don't exist yet — until they do, follow "Prior art is the template" above directly:

- New Layer 2 recipe → `skills/add-recipe/SKILL.md` (planned)
- New target emitter → `skills/add-emitter/SKILL.md` (planned)
- New conformance test → `skills/add-conformance-test/SKILL.md` (planned)

## Conformance feedback

Conformance-test failure messages are written for the coding agent to read and self-correct: state what is missing, where to add it, and which skill or prior-art file to follow. The failing test is the prompt.

## Architecture

Full baseline and the decision history live in the wiki — start at `docs/wiki/index.md`, with the decision ledger at `docs/wiki/decisions.md`. Read it before proposing any structural change. (`docs/ARCHITECTURE.md` is now a thin redirect into the wiki.)
