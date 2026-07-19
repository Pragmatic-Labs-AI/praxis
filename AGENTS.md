<!-- praxis:shared-project begin -->
# Praxis

**Status:** the methodology harness plus first-class Claude Code and OpenAI Codex targets (and the generic `agents-md` convention) are on `main`. Latest: **launch prep** (D58) — the in-repo half of the org migration: the package is now **`@pragmatic-labs/praxis`** (0.1.17, same 0.x line), the Node floor is `>=22.12.0` (CI on Node 22), the public-snapshot builder emits a signed-off `main` root commit under a pinned public identity, the boundary sweep is genuinely case-insensitive and offline-safe, and the one-time npm first-publish bootstrap is recorded (trusted publishing binds only to an already-existing package). Earlier: **OSS-launch hardening** — consumer-repo path/symlink containment and full-SHA-pinned plugin sources (D54/D55), plus the public-boundary pipeline and the release boundary (D56/D57): an allowlist-driven public-snapshot builder with an executed secret/term sweep, OSS hygiene files with a live DCO sign-off gate, and a tag-triggered npm trusted-publishing release workflow as the single protected publish path (inert until console bindings exist); the **workspace tier** (D53); **project-local packages** (D49). Praxis remains an npx-publishable TypeScript/Node CLI; see `docs/wiki/decisions.md` for the decision ledger and `docs/wiki/index.md` for the durable project map.

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

<!-- praxis:begin karpathy-claude sha256=581691def114ecb584d6beedc6309c816a028dec1693a0d369b72393e1aa76f3 (managed by praxis - edit praxis.yaml then run: praxis sync) -->
## Methodology — Layer 1 (general)

Behavioral guidelines that reduce common LLM coding mistakes. They are
tool-agnostic; merge with project-specific instructions as needed.

Tradeoff: these bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think before coding

Don't assume, don't hide confusion, surface tradeoffs. State assumptions
explicitly and ask when uncertain. Offer a simpler approach if one exists. Stop
and ask when something is unclear rather than guessing.

### 2. Simplicity first

Write the minimum code that solves the problem. No speculative features, no
abstractions for single-use code, no error handling for impossible cases. If 200
lines could be 50, rewrite. Test: would a senior engineer call this
overcomplicated?

### 3. Surgical changes

Touch only what the task requires. Don't refactor, reformat, or "improve"
adjacent code. Match the existing style. Mention unrelated dead code rather than
deleting it. Remove only the orphans your own change creates. Every changed line
should trace to the request.

### 4. Goal-driven execution

Define success criteria, then loop until verified. "Add validation" becomes
"write tests for invalid inputs, then make them pass." State a brief plan with a
verify step per item.

Working if: fewer unnecessary diffs, fewer rewrites from overcomplication, and
clarifying questions before implementation rather than mistakes after.
<!-- praxis:end karpathy-claude -->

<!-- praxis:begin instruction-upkeep sha256=ac475c577fc0b71c292fb8f291d0e1a1700283825fe49865c6b9d675ae404c69 (managed by praxis - edit praxis.yaml then run: praxis sync) -->
## Instruction upkeep

The authored agent instruction layer drifts as a
project changes. When it goes stale, incomplete, or a misunderstanding
surfaces, fix it — checking coverage against: build/test/run commands ·
layout · conventions · always-do rules.

When multiple first-class targets are selected, audit every native project
instruction surface. Shared project sections must remain consistent; native
target-specific sections may differ.

Make changes through `$praxis-instructions`, not ad-hoc edits. When
reconciling the methodology layer after a change, enter through
`$praxis-upkeep` (which delegates here) instead of running this pass alone.
<!-- praxis:end instruction-upkeep -->

<!-- praxis:begin session-handoff sha256=90ecc15cf739f428435b024ea5096ee6730209074f8f3e025dfa3db802ce5678 (managed by praxis - edit praxis.yaml then run: praxis sync) -->
## Session handoff

Work outlives a single session: at a natural boundary in a verified state —
never mid-edit — capture context before it's lost. Write handoffs by running
`$praxis-handoff`, not by hand; it's the next session's only briefing.

## Delegated execution

Delegate when you need the result, not the execution detail. Two triggers,
neither requiring parallelism: **independent workstreams** (specifiable up
front, no mid-flight coordination) and **context/budget isolation** (a
context-heavy or mechanical run worth its own context and a lighter tier —
holds even for one sequential stream). Name the split at plan time. Produce
each brief with `$praxis-handoff`, not by hand, and verify a returned
workstream against its success criterion before integrating it.
<!-- praxis:end session-handoff -->

<!-- praxis:begin wiki-memory sha256=d8753b5a42ab743e2e7ea4030b527a52f9a77e59bc8438fe1aa51ceaff961aa7 (managed by praxis - edit praxis.yaml then run: praxis sync) -->
## Wiki memory

Knowledge outlives a single conversation. Keep a durable, in-repo knowledge
wiki — linked markdown pages a future session reads instead of re-deriving —
distinct from a handoff (transient) and from authored agent instructions
(the instruction layer). At the start of a task, read the wiki's `index.md`
and follow the links that bear on the work.

When you learn something durable — an architecture fact, a gotcha, a decision,
a workflow — file or update it, and periodically lint the wiki for
contradictions and staleness. Do this by running `$praxis-wiki`, not by hand.
When reconciling the methodology layer after a change, enter through
`$praxis-upkeep`; call `$praxis-wiki` directly only for a deliberate single
pass (e.g. first-run bootstrap).
<!-- praxis:end wiki-memory -->

<!-- praxis:begin upkeep sha256=2a25651aae8b91285c901b519fe24734902294ece974d4c56aff6133315bec61 (managed by praxis - edit praxis.yaml then run: praxis sync) -->
## Upkeep

The methodology layer (instructions, wiki, emitted agent files) drifts
from project reality like code drifts from docs. When work reveals drift, or
produces new durable knowledge to file, run `$praxis-upkeep` — the single
front gate sequencing `praxis check`, `$praxis-instructions`, and
`$praxis-wiki` — rather than fixing it ad hoc or piecemeal.

When Claude Code and Codex coexist, this gate covers both native instruction
surfaces. Keep their project-owned shared sections synchronized while preserving
target-specific guidance; never make one surface import or replace the other.

Run all three passes through the gate even when only one looks like it has
work — skipping straight to a sub-skill is the piecemeal use this rule
prevents.
<!-- praxis:end upkeep -->

<!-- praxis:begin node-recipes sha256=1f945083a7dcb1e305c26d915c8296825ad0d7fddf4774a3ea0f1a4a28763f98 (managed by praxis - edit praxis.yaml then run: praxis sync) -->
Applies only when working on files matching: `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.mjs`.

## Node/TypeScript authoring recipes (Layer 2)

Stack-specific craft for TypeScript/Node code. These say *how to add something
well in this stack*; the concrete shape lives in this repo's own prior art, not
here. Find the nearest existing example and mirror it.

Layer 1 rules (think before coding, simplicity first, surgical changes,
goal-driven execution) apply unchanged — this file adds only what is
Node-specific.

- **ESM vs CJS, follow the repo.** Match the module system, `.js` import
  specifiers under `"type": "module"`, and the `tsconfig` target already in
  use — don't introduce a second convention.
- **Every promise is handled.** `await` it, `return` it, or explicitly `void`
  it with a comment explaining why. A floating promise swallows its rejection
  and its ordering.
- **Never silence the type checker.** No `any`, no `as` cast, no non-null `!`
  to make an error disappear. Fix the type; a suppressed error is a runtime
  bug deferred.
- **Prefer the platform before a dependency.** `node:`-prefixed builtins
  (`node:fs/promises`, `node:path`, `node:crypto`) and global `fetch` cover
  most needs; justify a new dependency against what neighbouring files
  already import.
- **Throw `Error` subclasses, never strings.** Attach `cause` when
  re-throwing, and handle `error` events on child processes and streams — an
  unhandled one crashes the process.
- **Validate untrusted input where it enters.** Use the repo's validator
  (e.g. zod) with a non-throwing parse (`safeParse`-style) at the boundary;
  don't re-validate data already typed and checked upstream.
<!-- praxis:end node-recipes -->

<!-- praxis:begin node-testing sha256=bb6101956ba965346360e7f8c7ffd8b06f8fca57d9dc8fa4113a04780d3e1a59 (managed by praxis - edit praxis.yaml then run: praxis sync) -->
Applies only when working on files matching: `**/*.ts`, `**/*.tsx`, `**/*.test.ts`, `**/*.spec.ts`.

## Node/TypeScript test-layer recipe (Layer 2)

Choosing *where* a test belongs matters as much as writing it: pick unit,
integration, or conformance/end-to-end by what could actually break —
unit for a single module's logic, integration for real seams (filesystem, a
spawned process, a built artifact), conformance/e2e for rails the whole tool
must honour. Then mirror the nearest existing test of that same layer for its
runner, file location, naming, and fixtures rather than inventing a new shape.

Layer 1 rules (think before coding, simplicity first, surgical changes,
goal-driven execution) apply unchanged — this file adds only what is
Node-testing-specific.

- **One runner in `package.json`.** Use whichever of vitest or jest the repo
  already has; don't add a second runner or a new assertion library for what
  plain `expect` calls already cover.
- **Await the assertion chain.** `await` or `return` a promise-returning
  assertion (e.g. `expect(promise).rejects...`) — a test whose promise
  resolves after the test function returns asserts nothing and passes falsely.
- **Restore fake timers.** Pair `vi.useFakeTimers()`/`jest.useFakeTimers()`
  with a restore in teardown, and never mix fake timers with a real
  `setTimeout` await inside the same test.
- **Reset mocks between tests.** No shared mutable module state leaking across
  cases; restore spies/mocks in `afterEach` so test order can't change the
  outcome.
- **Temp dir for real-filesystem tests.** Use `fs.mkdtemp` (or the repo's tmp
  helper) and clean up in teardown; never write into the repo tree or a fixed
  path on disk.
<!-- praxis:end node-testing -->

<!-- praxis:begin onboarding sha256=b7f2773e1af5807f36b7779e6c962edcbbecf21ffb6f635459d7cd3db0e2aef8 (managed by praxis - edit praxis.yaml then run: praxis sync) -->
## First-run onboarding

At the start of work, check for the `.praxis-setup-pending` sentinel file in
the repo root: present means a fresh Praxis install whose project-owned agent
instruction sections aren't authored yet.

- **Present:** offer to run `$praxis-onboard`; it deletes the sentinel on
  completion, making this check one-shot. Never nag when absent.
- **Absent:** do nothing here — `$praxis-upkeep` (ongoing front gate, D29/D31)
  handles currency after initial setup.
<!-- praxis:end onboarding -->
