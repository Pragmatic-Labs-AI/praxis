---
description: Capture this team's own coding patterns from an exemplar module into a project-local Praxis package that rides praxis sync.
argument-hint: [optional-exemplar-path]
allowed-tools: Read, Glob, Grep, Bash(git log:*), Bash(git diff:*), Bash(ls:*), Bash(mkdir:*), Write, Edit, Bash(npx @pragmatic-labs/praxis@latest sync:*), Bash(npx @pragmatic-labs/praxis@latest check:*), Bash(npx @pragmatic-labs/praxis sync:*), Bash(npx @pragmatic-labs/praxis check:*), Bash(praxis sync:*), Bash(praxis check:*)
---

Exemplar: {{arguments}} — if empty, propose candidates in step 2 rather than
picking silently.

Praxis never calls an LLM (D12) or authors project facts directly (D13). The
**agent** — you — extracts and authors every pattern below *with the user*;
Praxis's own CLI only resolves, emits, and syncs the package once it exists.

1. **Preflight.** Read `praxis.yaml` (`targets`, `stacks`, `packages`). If a
   `./`-prefixed entry already resolves to a local patterns package (its
   `package.yaml` under `praxis/packages/<name>/`), this is a refinement run:
   read its `rules.md` and offer to update or extend it rather than create a
   new one. State the framing above up front so the user knows what's about to
   happen.

2. **Exemplar interview.** Ask the user to point at one to three modules or
   directories that best show how code in this repo *should* look. If they
   can't choose, propose candidates — central, recently and frequently touched
   directories — and confirm before proceeding, never pick silently:

   - Recently touched: {{shell:git log --oneline -20 2>/dev/null}}
   - Frequently touched: {{shell:git log --pretty=format: --name-only -50 2>/dev/null | sort | uniq -c | sort -rn | head -20}}

3. **Extract candidates.** Read the exemplar(s), their immediate neighbors,
   and their tests. Derive candidate patterns across this checklist: module
   structure & naming, import/dependency habits, error handling,
   typing/validation, IO-vs-logic separation, test shape & location,
   comment/doc style. Every candidate cites concrete evidence — the file and
   the shape in it that shows the pattern. Never propose a pattern the code
   does not actually exhibit.

4. **Iterate.** Present candidates in small groups; the user accepts, rejects,
   or refines each. When a candidate is a recognized anti-pattern, push back
   once with rationale — what breaks, and when — then let the user decide; if
   they keep it, record it plainly rather than silently dropping the pushback.
   A convention enters the package only if it's verifiable in the exemplar or
   explicitly confirmed by the user.

5. **Scaffold the local package.** Default to
   `praxis/packages/codebase-patterns/`; confirm the name with the user
   (kebab-case — the declared `name` must equal the directory basename, same
   rule as a shipped package). Write:

   - `package.yaml` — `name`, `layer: local`, `provides: [rules]`.
   - `rules.md` — compact imperative bullets, each with a one-line why and an
     exemplar pointer (`path` — what it shows). Aim under ~60 lines; this file
     is always-loaded once installed, so keep it to what earns that cost. Use
     `paths:` frontmatter only if the conventions are scoped to a subtree.

6. **Register.** Add `./praxis/packages/codebase-patterns` (or the confirmed
   path) to the `packages:` list in `praxis.yaml`. Editing the manifest and
   syncing is the only customization path — never write emitted files by hand.

7. **Sync + verify.** Run `praxis sync` if the CLI is on PATH, otherwise fall
   back to `npx @pragmatic-labs/praxis@latest sync` (pin `@latest` — a bare
   `npx @pragmatic-labs/praxis` can silently reuse a stale cached build). Then
   run `praxis check` (or the `npx` equivalent) and fix anything it reports
   before finishing.

8. **Report.** Summarize the conventions captured (with their exemplar
   pointers), any candidates the user rejected and why, and note that this
   command is re-runnable anytime to refine or extend the package as the
   codebase evolves.
