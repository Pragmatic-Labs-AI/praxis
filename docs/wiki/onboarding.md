---
praxisAnchors:
  - type: path
    target: packages/layer1/instruction-upkeep
  - type: path
    target: packages/layer1/onboarding
  - type: path
    target: src/init.ts
  - type: path
    target: src/shared-instructions.ts
  - type: section
    target: docs/wiki/decisions.md#11-decision-record
---
# Project facts vs methodology; agent-driven onboarding

An instruction file (`CLAUDE.md`/`AGENTS.md`) holds two kinds of content:

- **Methodology** — general (Layer 1) + stack (Layer 2). Durable, portable.
  **Praxis owns this** (managed blocks / owned `.claude/rules/` files).
- **Project facts** — how *this* repo builds/runs/tests, its architecture and
  conventions. Specific and drift-prone. **The project owns this; Praxis never
  authors it** (it would be the unverified, generator-style content the
  inclusion bar forbids).

How project facts get written well *without* Praxis generating them, given
[D12](decisions.md#11-decision-record) (Praxis never calls an LLM): the
**agent** writes them, guided by methodology Praxis installs.

- **Existing repo:** facts already exist (hand-written or via a tool-native
  initialization workflow). Praxis composes methodology in and leaves facts untouched.
  Onboarding instead *tunes* over several sessions — the agent advises
  ("package X looks unused"), the human edits `praxis.yaml` and re-syncs.
- **New repo:** Praxis defers fact *generation* to the ambient agent and to an
  **onboarding skill** it ships.

## Onboarding mechanism (D14): sentinel auto-trigger + skill

**Built (D35).** The first-run onboarding mechanism is now shipped as the
`onboarding` Layer 1 package (`packages/layer1/onboarding/`):

- `praxis init` writes a transient **`.praxis-setup-pending` sentinel** at the
  repo root when any selected first-class target lacks its instruction surface
  (`CLAUDE.md` for Claude, `AGENTS.md` for Codex), or when a dual Claude+Codex
  install lacks peer shared-project blocks. The sentinel is
  written directly in `applyInit`, outside the sync pipeline, so `praxis check`
  never treats it as drift.
- A small **bootstrap rule** triggers the target-native onboarding workflow
  (`/praxis-onboard` or `$praxis-onboard`) at the start of the next session: *if the sentinel is
  present, offer onboarding; once done the skill removes the sentinel.* One-shot
  and self-terminating — no nag.
- The onboarding workflow holds the procedure: use native discovery where
  available, then layer
  methodology-guided sections (build/run/test · layout · conventions · always-do
  rules), ask the user for anything not inferable (D12 holds — Praxis never
  authors facts), write only project-owned content (D13 holds), and delete the
  sentinel. Codex-only installs author free prose in `AGENTS.md`; Claude-only
  installs retain `CLAUDE.md`. With both, neither file is canonical and neither
  imports the other. The agent writes identical project facts inside one
  unhashed `praxis:shared-project` block in each native file; prose outside the
  blocks remains target-specific and independent. Both files therefore keep
  working if Praxis is removed.

The *ongoing* half — **instruction upkeep** — is the separate `instruction-upkeep`
package (D22): a standing `rules.md` reminder plus the `/praxis-instructions`
command, which diffs every selected first-class instruction surface against the
project's canonical docs and recent history, asks before editing, and prefers
linking over restating. In dual-target repos it treats missing/mismatched shared
blocks as authored drift and updates both together only after approval.
It also covers **completeness**, not just currency (D23): a rubric (build/test/run
commands · layout · conventions · always-do rules) flags a section that's missing
entirely, the same way step 2 flags one that's stale — the rule states the
requirement, the agent fills the content by discovery + asking, never invents.
Note: "instruction", not "memory" — this is the authored instruction layer
(`CLAUDE.md`/rules), distinct from the tool's native auto-memory and from any
3rd-party agent-memory *system* ([gotchas](gotchas.md)).

## Symmetric front gates (D36)

**Built (D36).** the target-native Praxis onboarding and upkeep workflows are symmetric front gates:

- **Onboard** — first-run gate. Authors project-owned agent instruction facts,
  runs each installed package's bootstrap action (today: `wiki-memory`'s
  `/praxis-wiki` seeds `docs/wiki/` so future sessions read instead of re-deriving),
  then hands off to `/praxis-upkeep` so the full baseline is established in one pass.
- **Upkeep** — ongoing gate (D29/D31/D48). Sequences `praxis check` → the
  target-native instructions workflow → the target-native wiki workflow and
  reports across all three. Deterministic sync fixes generated artifacts; the
  instruction pass fixes project-owned shared-block drift without choosing an
  automatic winner.

Package lifecycle actions are declared in `package.yaml` as an optional
`onboarding: { command, summary }` field (D20's declared-contract principle,
extended). `planEmit` composes declared hooks into the onboard command at emit
time — the target repo never sees `package.yaml` — via a
`<!-- praxis:bootstrap-delegations -->` marker that is replaced with a bullet list
of every selected package declaring a hook. Declarers today: `wiki-memory`
(seed the knowledge wiki) and `capture-codebase-patterns` (capture the team's
own patterns into a project-local package, D50). `instruction-upkeep` and
`upkeep` don't declare a hook — onboard's own fact-authoring IS the
instruction bootstrap, and no package needs a recurring create action.

## Dogfooding first-run (manual ritual)

Because Praxis never calls an LLM (D12), CI can only assert the **deterministic**
first-run surface (sentinel written + composed onboard command present + no
post-init managed drift). The **live** onboarding flow — where the agent actually
authors native project facts, seeds the wiki, hands off to upkeep for parity
verification, and only then removes the sentinel — is manual. The sentinel
survives until the whole baseline is established so an interrupted session
still gets re-offered onboarding next time; deleting it any earlier would
leave the wiki unseeded with no re-offer.

**Fixture:** `examples/fresh-app/` — a minimal node project (one `package.json`,
one source file, a README) with no `CLAUDE.md`, no `praxis.yaml`, and no `.claude/`.
This is the stable, checked-in target a maintainer runs the live flow against.

**Automated coverage:** `conformance/onboarding-fixture.conformance.test.ts` copies
`examples/fresh-app/` into a tmpdir, calls `applyInit`, and asserts the deterministic
surface: sentinel written, emitted `praxis-onboard` command contains `/praxis-wiki`
delegation and references `/praxis-upkeep`, and `praxis check` reports no drift.

**Manual dogfood procedure:**

```bash
# 1. Copy the fixture out of the repo into a fresh directory
TMP=$(mktemp -d)
cp -r examples/fresh-app/. "$TMP"/
git -C "$TMP" init -q

# 2. Run praxis init (uses the built dist)
cd "$TMP"
node /path/to/praxis/dist/cli.js init --yes
# Or: npx @pragmatic-labs/praxis init --yes

# 3. Open the tmpdir in a selected agent and run /praxis-onboard or $praxis-onboard
# The workflow should: author project facts (build/run/test, layout, conventions,
# always-do rules), write peer shared blocks when Claude+Codex coexist, seed
# docs/wiki/, hand off to upkeep, and only then remove .praxis-setup-pending.

# 4. Confirm the sentinel is deleted and inspect the selected native surfaces
ls .praxis-setup-pending 2>/dev/null && echo "ERROR: sentinel not deleted" || echo "OK"
ls docs/wiki/index.md

# 5. Clean up
rm -r "$TMP"
```

**What the live flow exercises (not assertable in CI):**
- Agent authors project-owned native instruction sections from config files + user Q&A
- Dual Claude+Codex installs keep exact shared blocks while allowing native differences
- `/praxis-wiki` seeds `docs/wiki/` with an index and orientation page
- `/praxis-upkeep` confirms the full methodology baseline is in sync
- Sentinel is deleted — making onboarding truly one-shot
