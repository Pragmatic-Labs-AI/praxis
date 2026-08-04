---
description: Run the deterministic drift check plus the instruction-layer audit and wiki maintenance passes, and report one consolidated result.
argument-hint: [optional-area-to-focus]
allowed-tools: Bash(npx @pragmatic-labs/praxis@0.3.0 check:*), Bash(npx @pragmatic-labs/praxis@0.3.0 sync:*), Bash(praxis check:*), Bash(praxis sync:*)
---

Focus: $ARGUMENTS — if empty, cover all three passes at a high level.

This is the single entry point for "is my methodology layer still current
with reality?" It sequences three existing checks rather than re-implementing
them — restating their logic here would duplicate content that drifts
independently of its canonical home.

1. **Deterministic drift.** Run `praxis check` if the CLI is on PATH. Otherwise
   fall back to `npx @pragmatic-labs/praxis@0.3.0 check` — pinned to
   this repo's `methodology:`, never `@latest`. A bare
   `npx @pragmatic-labs/praxis` can silently reuse a stale cached build, but
   `@latest` is worse than useless here: `methodology:` must equal the running
   CLI exactly, so a newer CLI makes `check` and `sync` refuse to run at all.
   Upgrading is `/praxis-upgrade`'s job, never a side effect of
   upkeep. If it reports file drift, run `praxis sync` (or
   `npx @pragmatic-labs/praxis@0.3.0 sync`) to fix it. Use
   `sync --dry-run` first if you want to see the rewrite before it lands.
   Surface managed-block conflicts, shared-project parity
   drift, or broken anchors as-is. `sync` fixes generated artifacts but must
   never choose a winner between project-owned `CLAUDE.md` and `AGENTS.md`
   blocks; route that drift to the instruction pass below.
   This step needs no LLM judgment — do it first so the semantic passes below
   build on a known-good baseline. **If the CLI is unavailable even via npx,
   skip only this step and proceed with steps 2 and 3 — do not skip the entire
   pass.**

   Read the output, don't just check the exit code. A completed check prints a
   `praxis v<version>` line and a `Knowledge anchors: <N> checked` line. **If the
   anchor line is absent, or the command errored (e.g. an unknown-package or
   invalid-manifest message), the check did not fully run — report that as a
   failure, never as "0 checked, all fine".** A stale npx-cached CLI is the usual
   cause; re-run with the `@0.3.0` pin above, and if the reported
   version still differs from `methodology:`, report that mismatch rather than
   working around it.
2. **Instruction layer.** Perform the update defined by `/praxis-instructions`,
   scoped to the focus above. Follow that command's own steps; do not
   re-derive them here.
3. **Wiki.** Perform the wiki maintenance defined by `/praxis-wiki`, scoped to
   the focus above — it files newly-authored knowledge and lints existing pages,
   and no-ops when there is nothing to do. Follow that command's own steps; do
   not re-derive them here. (Full delegation, symmetric with the audit pass —
   not a hand-picked phase, which would restate the skill's logic.)
4. **Consolidated report.** Summarize across all three passes: what's in
   sync, what drifted, what was fixed, and what still needs the user's call.
   Both sub-passes already gate edits on user confirmation before changing
   anything — preserve that here; this command must not bypass it.
