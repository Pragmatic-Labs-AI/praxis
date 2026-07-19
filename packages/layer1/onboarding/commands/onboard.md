---
description: Author project-owned agent instructions for a fresh Praxis install—build/run/test commands, layout, conventions, and always-do rules. One-shot: deletes .praxis-setup-pending when done.
---

Scope: {{arguments}}

This is the **first-run front gate** — the single entry point for a fresh Praxis
install, symmetric to `{{workflow:praxis-upkeep}}` (the ongoing front gate). It authors
the **project-owned** agent instructions, then seeds the installed methodology
packages, then hands off to `{{workflow:praxis-upkeep}}` so the full baseline is established
in one pass.

Praxis never calls an LLM (D12) or authors project facts directly (D13). The
**agent** writes the facts, guided by the steps below, asking the user for
anything it cannot infer.

1. **Choose the project instruction surfaces from `praxis.yaml`.** For a Codex-only
   install, author project facts as free prose outside managed blocks in `AGENTS.md`.
   For Claude-only, retain the existing `CLAUDE.md` flow. When both are selected,
   maintain both native files as peers — never make either import or replace the
   other. Put facts shared by both tools inside exactly one project-owned block in
   each file, with identical content and these marker lines:

   ```markdown
   <!-- praxis:shared-project begin -->
   ...shared project facts...
   <!-- praxis:shared-project end -->
   ```

   The markers declare a parity contract, not Praxis ownership: the project owns
   the prose and both native files remain complete if Praxis is removed. Guidance
   outside this block may differ by target. If the active tool offers a native
   repository initialization workflow, suggest it for bulk discovery and
   incorporate useful output rather than re-deriving it.

2. **Check detected stacks (if known).** Read `praxis.yaml` for the `stacks:`
   field. If stacks are declared, tailor the sections below to those stacks (e.g.
   for `node`, prefer `npm run …` commands; for `python-backend`, prefer `pytest`
   / `poetry` patterns; for `react`, note the dev server and component test
   runner). Never invent stack facts — confirm them from config files
   (`package.json`, `pyproject.toml`, etc.).

3. **Author the four rubric sections.** For each section, read the project's
   config files and recent git history, then write only what is verifiably true.
   Ask the user before adding anything that isn't clear from the code:

   - **Build / test / run commands** — the exact commands to typecheck, build,
     run the test suite, and start the app. Include any CI commands that differ
     from local. Never guess; confirm from `package.json` scripts, `Makefile`,
     `pyproject.toml`, etc.
   - **Project layout** — key directories and their purpose. One sentence per
     entry is enough; link canonical docs rather than restating their content.
   - **Key conventions** — branch/PR flow, what a change must ship with (tests,
     docs update, etc.), naming conventions, anything a newcomer would violate.
   - **Always-do rules** — the small set of non-negotiable habits (e.g. "run
     `praxis check` before pushing", "never commit secrets"). Keep this list
     short; a long always-do list is never read.

4. **Ask the user for anything not inferable.** If a section can't be filled from
   config files, git history, or the native initialization workflow's output, ask
   a targeted question rather than inventing a plausible answer. Content
   inclusion bar: a fact only enters if it's backed by the code, config, a
   canonical doc, or the user.

5. **Write only project-owned content.** Never put content inside a Praxis
   managed block (a `<!-- praxis:begin … -->` / `<!-- praxis:end … -->` region).
   Project facts belong in the free-prose sections the author controls; the
   unhashed `praxis:shared-project` block is also project-owned. Praxis owns only
   its hashed managed blocks. When both native files are selected, write the four
   rubric sections to both shared blocks in one edit and keep their content exact.

6. **Run each installed companion bootstrap action** (each seeds part of the
   methodology), then hand off to `{{workflow:praxis-upkeep}}`:

<!-- praxis:bootstrap-delegations -->

   After the bootstrap actions above complete, run `{{workflow:praxis-upkeep}}` to confirm
   the full methodology baseline is in sync. If `{{workflow:praxis-upkeep}}` is not
   installed, skip this step.

7. **Delete `.praxis-setup-pending`** to make this one-shot. Once the rubric
   sections are authored, the bootstrap actions and upkeep pass above have run,
   and the user is satisfied, remove the sentinel file from the repo root. This
   prevents the bootstrap rule from re-offering onboarding on the next session —
   deleting it any earlier would leave an interrupted session with no re-offer
   and an unseeded baseline.

8. **Report what was written / left.** Summarise which rubric sections were
   filled, which were left empty (and why — e.g. "no build step detected"), and
   any follow-up items for the user. The baseline is now established; from here
   `{{workflow:praxis-upkeep}}` keeps the methodology layer current.
