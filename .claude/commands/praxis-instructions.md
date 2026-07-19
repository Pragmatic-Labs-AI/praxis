---
description: Keep the project's authored agent instruction files current with its state and complete against the standard rubric.
---

Scope: $ARGUMENTS

This updates the **authored agent instruction layer** — project-owned prose in
the selected tool's instruction surfaces — not native auto-memory and not any 3rd-party
agent-memory system. Those are out of scope.

1. Read `praxis.yaml`, then read every project instruction surface selected by
   its first-class targets (`CLAUDE.md` for Claude Code, `AGENTS.md` for Codex).
   Identify any
   canonical doc they point to (architecture doc, decision log, design doc).
2. Compare what the instruction files claim against that canonical doc and
   against recent git history (`git log`, changed files) and the current
   code/config. List concretely what is stale, missing, or now contradicted —
   cite the file and line for each. Then check operational completeness
   against this rubric — does the instruction layer document:
   - build/test/run commands (and how CI verifies the repo, if there is one)
   - project layout (key directories/modules)
   - key conventions (e.g. branch/PR flow, what a change must ship with)
   - always-do rules (the few non-negotiable habits)

   Flag any rubric section that's entirely absent, citing where it should go.
   When Claude Code and Codex are both selected, inspect the project-owned
   `praxis:shared-project` block in both native files. Their contents must match
   exactly (apart from line endings), while prose outside the blocks may differ.
   Treat a missing, duplicate, or mismatched block reported by `praxis check` as
   authored instruction drift — never choose one file as the automatic winner.
3. **Ask the user before editing anything.** Present the list from step 2 and
   confirm which items to fix.
4. For approved items, update only project-owned sections of the instruction
   files — never invent a fact that isn't backed by the canonical doc, the
   code, or the user's answer. Where an instruction file currently restates a
   fact that lives in a canonical doc, prefer replacing the restatement with a
   link to that doc (reference, don't duplicate) so it can't drift again.
   In a dual-target repo, apply approved shared-fact changes to both shared blocks
   together and preserve all target-specific content outside them.
5. If an instruction file carries `praxisAnchors` frontmatter, revalidate and
   update the anchors for any changed source reference. Phase-2 anchors are
   deterministic only:
   - `type: path`, `target: repo/relative/path`
   - `type: command`, `target: npm run <script>` or `npm <script>`
   - `type: section`, `target: docs/file.md#heading-slug`

   Do not add hash/staleness tripwires here yet; those are future advisory
   signals. Run `praxis check` if available and fix broken anchors before
   reporting completion.
6. Report what changed and what was left as-is, with reasons.
