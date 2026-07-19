# Conformance tests

Conformance tests assert that the repo upholds Praxis's **architectural
invariants** — the rules from `CLAUDE.md` and the [design
wiki](../docs/wiki/index.md) that prose alone can't enforce. They are the
harness the whole project sits on: *a rule that matters has a test.*

They are distinct from the behavioral unit tests in `test/`:

| `test/*.test.ts` | `conformance/*.conformance.test.ts` |
|---|---|
| "does this function do the right thing?" | "does the repo still obey the architecture?" |
| ordinary assertions | invariant + an agent-readable failure message |

## The one rule for writing them: the failing test is the prompt

A conformance failure is read by the coding agent that caused it, and it must be
enough to self-correct from — with no other context. Every failure message states:

1. **What is wrong** — the invariant that broke, with `expected` vs `actual`.
2. **Where to fix it** — the file(s) that own the invariant.
3. **What to follow** — the prior-art file, decision, or skill that governs the
   change (e.g. "decision D3 caps the surface — adding a command needs an
   architecture decision first").

Write the message you would want to receive if you broke this test and knew
nothing else about the repo.

## Prior art is the template

There is no generator. To add a conformance test, copy the closest existing one
in this directory and mirror its shape — the contract constant at the top, the
invariant check, the guidance string passed as the assertion message. The
authoring skill `skills/add-conformance-test/SKILL.md` (Phase 3) will name the
prior-art file to mirror.

Prior art so far:
- `cli-surface.conformance.test.ts` — the CLI command surface must match its
  declared contract.
- `merge-engine.conformance.test.ts` — block-splice merge invariants
  (idempotency, byte preservation, conflict-not-clobber, marker-located blocks,
  opaque content).
- `manifest.conformance.test.ts` — `praxis.yaml` rejects unknown keys
  (declarative-truth contract).
- `emit.conformance.test.ts` — Layer 1 emit is tool-neutral: the singular source
  reaches every target, targets route to distinct files, content round-trips.
- `sync.conformance.test.ts` — the sync/check orchestration end-to-end:
  idempotent re-sync, conflict-not-clobber on disk, check is read-only, and
  check hard-fails on drift/broken anchors for the D26 PR gate.
- `shared-instructions.conformance.test.ts` — dual Claude+Codex project facts
  remain peer-native: check enforces shared-block parity, target-specific prose
  survives, and sync never chooses a project-owned winner (D48).
- `init.conformance.test.ts` — `init` writes a loader-valid `praxis.yaml` and
  lands a fresh repo fully in sync (check is a no-op afterward).
- `packages.conformance.test.ts` — the package loader: unknown package fails
  loudly, `provides` drives emit, `requires`/`conflicts` are enforced.
- `merge-json.conformance.test.ts` — JSON-aware permission merge invariants
  (idempotency, preserves unrelated keys + user rules, removal on update,
  conflict-not-clobber per bucket, valid-JSON-out, top-level `_praxis` marker).
- `permissions.conformance.test.ts` — the permission policy is tool-neutral and
  emitted per-tool: closed capability vocabulary (no silent drop), Claude Code
  emits valid rules to `.claude/settings.json`, tools with no model emit nothing,
  opt-in (no policy package → no op), idempotent.
- `commands.conformance.test.ts` — slash commands are a tool-neutral artifact
  emitted per-tool: Claude Code delivers owned `.claude/commands/praxis-*.md`
  files, tools with no command model emit nothing, opt-in (no commands package
  → no op), idempotent.

## Running

```
npm run conformance     # the gate — conformance tests only
npm test                # behavioral unit tests only
```

Both run in CI as separate steps so the gate is visible, not buried.
