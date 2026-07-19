---
praxisAnchors:
  - type: section
    target: docs/wiki/decisions.md#11-decision-record
---
# Roadmap — done vs to-do

A single done/to-do view. **Derived** (the "Done" list — verifiable against the
code and the D1–D58 ledger) vs **canonical intent** (the "To-do" list — plans
and open decisions, not yet built). When this page and the code disagree, the
code wins for "Done"; an item only moves to "Done" once there's a shipped
package, emitter, or gate to point at.

## Done / built

- **Harness + CI gate.** Conformance-test framework, `.github/workflows/ci.yml`,
  prior-art-as-template convention (D1–D6 era; [workflows](workflows.md)).
- **Merge engine.** Text block-splice (markdown) + JSON-aware merge
  (`.claude/settings.json`), conflict-not-clobber, idempotent. See
  [merge-engine](merge-engine.md) (D7, D10, D11, D13).
- **Manifest loader.** `package.yaml` discovery + `resolve()` enforcing
  `requires`/`conflicts` (D20/D21). See [packages-and-emit](packages-and-emit.md).
- **Emitter — four artifact kinds.** `rules`, `permissions`, `commands`, and
  `plugins` (D28), routed per target; `permissions`+`plugins` compose into one
  `.claude/settings.json` write. See [packages-and-emit](packages-and-emit.md)
  and [emitters](emitters.md) (D18–D24, D28).
- **First-class OpenAI Codex emitter (D47).** Native `AGENTS.md` rules,
  `.agents/skills` workflows, permission profiles and command rules,
  compatibility-gated repo plugins, and target-aware init/onboarding.
- **Project-local packages (D49).** A `./`-path entry in `praxis.yaml`
  `packages:` resolves a package directory living in the target repo itself,
  first-class through resolve/emit/sync/prune (new `layer: local`; collisions
  are hard errors; loaders are dir-based). See
  [packages-and-emit](packages-and-emit.md) "Project-local packages".
- **`sync` / `check`.** Reconcile repo → manifest; dry-run drift report for CI.
  `sync` prunes orphaned emitted files on package removal (D46); `check` prints
  an advisory methodology-size line (D45).
- **Recipe dedupe + deepening (D44/D51).** Layer 2 recipes defer to Layer 1
  instead of restating it, and carry stack-specific failure modes; both
  enforced by conformance.
- **Workspace tier (D53).** A meta-repo hub over N independent git repos:
  `workspace:` manifest section, the `workspace`-gated package with
  `/praxis-workspace-upkeep`, member-aware anchors, init-wizard detection.
  Slices 2–3 (child-side awareness, `check --workspace`) deferred — see To-do.
- **Peer-native dual targets (D47/D48).** Codex first-class alongside Claude
  Code; the shared `praxis:shared-project` block keeps project facts in parity.
- **Self-hosting.** Praxis installs its own methodology; `npm run selfcheck`
  gates drift in its own CI ([self-hosting](self-hosting.md)).
- **`init` — full install workflow (D17 → D33).** Multi-stack **detection**
  (python-backend/node/react; a `react` dep ⇒ both `node`+`react`) wired into a
  **data-driven** Quick-start default (`defaultManifest` = all Layer 1 + Layer 2
  for detected stacks), plus the **Quick-start / Customize** fork (Customize =
  stacks/packages/targets multiselects via `manifestFromSelections`). `--yes` =
  non-interactive Quick-start. Closes D17's deferred Customize half.
- **Distribution — published on npm (D32).** Public scoped package
  `@pragmatic-labs/praxis`; `npx @pragmatic-labs/praxis` runs anywhere. `prepublishOnly`
  builds `dist/` at publish; `npm publish` stays a human step.
- **Packages shipped:** `karpathy-claude` (Layer 1 rules), `safe-permissions`
  (D18/D19, opt-in), `instruction-upkeep` + `/praxis-instructions` (D22/D23),
  `session-handoff` + `/praxis-handoff` (D24), `wiki-memory` + `/praxis-wiki`
  (D25), `upkeep` + `/praxis-upkeep` (D29, widened to a full front gate in D31),
  `onboarding` + `/praxis-onboard` (D35 — first-run onboarding),
  `capture-codebase-patterns` + `/praxis-capture-codebase-patterns` (D50 —
  captures a team's own patterns from an exemplar module into a project-local
  package, on the D49 rails),
  the `external`-layer `ponytail` / `drawio` plugin-marketplace packages (D28),
  and the **Layer 2** packages for all three planned stacks: `node-recipes` /
  `node-testing` (`stack: node`), `python-backend-recipes` / `python-testing`
  (`stack: python-backend`), and `react-components` / `react-testing`
  (`stack: react`) — all D30.
- **D14 onboarding sentinel auto-trigger (D35).** `praxis init` writes a
  `.praxis-setup-pending` sentinel when a selected first-class target lacks its
  project instruction surface; the onboarding rule triggers the target-native workflow on the
  next session; the skill deletes the sentinel when done — one-shot,
  self-terminating.
- **Layer 2 bootstrapped + all three stacks shipped (D30).** Multi-stack
  manifest (`stacks` array), flat `packages/layer2/<pkg>/` layout, per-package
  `stack` field + composition rule. The `node`, `python-backend`, and `react`
  stacks each ship a craft recipe + a test-layer recipe (Python/React mirror the
  Node prior art); only `node` is dogfooded in Praxis's own `praxis.yaml`.
  Deepening each stack's recipe set is ongoing (below). See
  [packages-and-emit](packages-and-emit.md).
- **Currency gate, Tier 1+2 (D26/D27).** `praxis check` hard-fails derived
  emitted-file drift and broken `praxisAnchors` (`path`/`command`/`section`).
  Full design captured in the D26/D27 ledger rows and [workflows](workflows.md).
- **OSS-launch security hardening — Phase 0/1 repo-file portion (D54/D55).**
  Apache-2.0 `LICENSE`/`NOTICE` + `package.json` `license`/`author` (published
  0.1.15); least-privilege, SHA-pinned CI + exact-pinned Codex + Dependabot;
  `npm-shrinkwrap.json` freezing the reviewed prod tree;
  `SECURITY.md` reporting/disclosure policy; consumer-repo path/symlink
  containment (`src/path-safety.ts` `resolveContained`, D54 — a real escape in
  every 0.1.x ≤ 0.1.15, shipped in the 0.1.16 fix release); full-commit-SHA
  pinning of every shipped plugin ref (D55). The rest of the Phase 0 boundary
  (sanitized public repo, secret sweep, OIDC publishing) stays open — see To-do
  item 0.
- **OSS-launch public + release boundary and hygiene (D56/D57).** The
  allowlist-driven public-snapshot builder and the boundary sweep (gitleaks
  v8.30.1 over all history/refs + snapshot + every published tarball, zero-hit
  term grep, `npm pack`), with the snapshot itself passing all five gates — **and
  the sweep executed** (all commits/all refs, snapshot, 0.1.0–0.1.16 tarballs;
  zero real secrets) — D56, the repeatable launch-audit tooling. The tag-triggered npm trusted-publishing `release.yml` as the sole
  publish path — OIDC, provenance, tokenless, five gates + pack-allowlist re-run
  against the tag (D57, inert until console bindings). OSS hygiene shipped:
  `CONTRIBUTING.md` (prior-art-as-template + conformance-as-reviewer + DCO), a
  live DCO CI check (`.github/workflows/dco.yml`), `CODEOWNERS`,
  `CODE_OF_CONDUCT.md`, issue/PR templates, `package.json` metadata,
  and the README repositioned around the drift-checked/CI-gated moat with a CI
  badge. Launch prep landed the in-repo half of the org/scope migration
  (D58: `@pragmatic-labs/praxis` 0.1.17, Node 22 floor, hardened signed-off
  snapshot root, corrected sweep, recorded first-publish bootstrap). Still
  open: creating/pushing the sanitized public repo, the console-side release
  bindings, and the console half of the migration (To-do item 0).

## To-do / pending

**Layer 2, the per-stack authoring recipes,** is bootstrapped with all three
planned stacks shipped (D30); depth (more recipes per stack) and breadth (more
stacks) remain. The differentiated core is the **gate + distribution
machinery**, with recipes as the payload that rides it
([orientation](orientation.md), D42). The current priority is the OSS
launch/content track (item 0 below), with further features pulled by real
usage rather than scheduled.

0. **OSS security gate + launch/content track** — in flight. **Done** (moved to
   the Done list above): Apache-2.0 `LICENSE`/`NOTICE` + `package.json`, hardened
   CI + Dependabot, `npm-shrinkwrap.json`, `SECURITY.md`, consumer-repo
   path/symlink containment (D54), immutable full-SHA plugin sources (D55), the
   allowlist-driven public-snapshot pipeline with its curated public wiki
   (per-row-redacted ledger) and the **executed** secret/term sweep across all
   history/refs + snapshot + the already-published 0.1.x tarballs (D56, the
   repeatable launch audit script), the tag-triggered OIDC/provenance release
   workflow (D57), and the OSS hygiene files (`CONTRIBUTING.md` with the live DCO
   CI check, `CODEOWNERS`, `CODE_OF_CONDUCT.md`, issue/PR templates,
   `package.json` metadata) + README repositioning. The npm org `pragmatic-labs`
   now exists. The **in-repo half of the org/scope migration is done (D58):**
   package renamed `@pragmatic-labs/praxis` at 0.1.17, every living reference
   moved, Node floor at 22, the snapshot builder emitting a signed-off `main`
   root under the pinned public identity, the boundary sweep corrected, and
   the one-time npm first-publish bootstrap recorded. **Launch repo created
   and seeded (2026-07-19):** the private `Pragmatic-Labs-AI/praxis`
   repository holds exactly the verified snapshot root commit (signed-off,
   pinned identity; sweep and all five gates green on the identical tree),
   with Actions default token read-only, the `release` environment carrying
   the `v*` tag deployment policy, and merge-commit-only history. GitHub
   gates rulesets, branch protection, and required environment reviewers
   behind a paid plan while a repo is private, so those protections are
   applied immediately after the visibility flip rather than before it.
   **Still open before/at the public flip:** the org-scope bootstrap publish,
   the remaining console-side release bindings that make the release workflow
   live (npm trusted-publisher binding, the `release` required reviewer, npm
   2FA/token-disable), private-vulnerability-reporting + secret-scanning/
   CodeQL enablement (free tier only on public repos), and the
   least-privilege contributor/core/release roles (recorded
   single-maintainer narrowing until maintainer #2) with protected
   CODEOWNER-reviewed core, applied as the immediate post-flip pass. Then
   deprecating the old scope in the new one's favor, and a launch write-up.

1. **Layer 2 stack recipes — three stacks shipped, deepening ongoing.** `node`,
   `python-backend`, and `react` each ship a craft recipe + a test-layer recipe
   (Python/React mirror the Node prior art;
   [packages-and-emit](packages-and-emit.md) "Two layers"). Open: growing the
   recipe set per stack and additional stacks.
2. **`init` devDependency offer** — the Customize wizard itself shipped (D33); the
   "add praxis as a devDependency so `sync` runs in CI" prompt is still deferred.
3. **Authoring skills** `add-recipe` / `add-emitter` / `add-conformance-test`
   (`CLAUDE.md` "Authoring (not yet built)") — until they exist, "prior art is
   the template" is followed by hand.
4. **More emitters — community territory.** First-party effort stays
   Claude-first with Codex peer-native (D47/D48); a Cursor emitter is left to
   community contribution (Cursor already reads the emitted `AGENTS.md`, so it
   works today at zero effort). Copilot/Windsurf/Roo likewise
   ([emitters](emitters.md)).
5. **Currency gate Tier 3** — staleness signals (advisory, never blocking) —
   plus a pre-PR finish command and an installable CI template
   (the currency-gate design's deferred later phases; D26/D27 shipped the
   blocking tiers).
6. **Deferred agent-memory runtime backends** (memsearch, claude-mem,
   agentmemory) — researched and deferred at D25; may return as optional
   packages if the need is shown. Distinct from `wiki-memory`, which ships now.
7. **External package-source loader; ecosystem later** — npm/git methodology
   sources remain the top delivery-pulled feature, bounded by the accepted
   security contract in the OSS roadmap: exact immutable source identity,
   digest-bearing committed lock/trust receipt, direct data-only fetch (no
   package-manager/lifecycle/shell execution), non-transitive authorization,
   consumer-owned permission/plugin allowlists, and frozen CI behavior. A
   public registry remains a separate, framework-sized commitment
   ([packages-and-emit](packages-and-emit.md)).
8. **Workspace tier slices 2–3 (D53 deferred).** Child-side awareness and a
   deterministic `praxis check --workspace` for hub CI — pulled by real
   workspace-hub usage.
9. **Open decisions** (full list: [decisions](decisions.md) bottom rows):
   marker migration across methodology versions; whether Layer 2 recipes may
   add devDependencies (bounds the D9 boundary); the external-source loader's
   implementation shape within its accepted security contract; productization
   — framing settled 2026-07 as free and open source, not a paid product.
   (Multi-stack *detection* and the Customize wizard are now built — D33.)

## Build order (historical)

The spine was Phases 0–2; everything after compounds on a verified merge
engine. Phases 0–2 and 4 (partially, via D16–D27) are done; Phase 3
(authoring skills) is still open (see "To-do" above).

0. **Decide & scaffold.** Repo setup (`package.json` bin, TypeScript,
   `vitest`, CI workflow). Settled in
   [interaction-model](interaction-model.md) and [merge-engine](merge-engine.md).
1. **The harness, first.** Conformance-test framework + CI gate +
   prior-art-as-template convention — the rails, no user-facing feature.
2. **First vertical slice.** Layer 1 emit + merge: one methodology source →
   `CLAUDE.md` + `AGENTS.md`. **Milestone:** [self-hosting](self-hosting.md).
3. **Authoring skills** (open) — `add-recipe`, `add-emitter`,
   `add-conformance-test`.
4. **Packages + Layer 2.** Manifest format + dependency-aware loader
   (`requires`/`conflicts`); Layer 2 packs shipped for all three planned stacks
   — `node`, `python-backend`, `react` (D30).
5. **Claude Code specifics.** Per-tool emitter variants and permissions, as
   *emitted* surfaces — preserving the neutral core.

`docs/ARCHITECTURE.md` has been fully retired into this wiki (see
[decisions](decisions.md) and the wiki [log](log.md) for the migration
history) and is now a thin redirect to [index](index.md).
