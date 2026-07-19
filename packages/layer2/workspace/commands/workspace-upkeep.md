---
description: Hub-sovereign workspace upkeep — audit this hub and its cloned members, report drift and proposed edits, and apply only what the user confirms.
argument-hint: [optional-member-or-area-to-focus]
allowed-tools: Read, Glob, Bash(git log:*), Bash(npx @pragmatic-labs/praxis@latest check:*), Bash(npx @pragmatic-labs/praxis@latest sync:*), Bash(npx @pragmatic-labs/praxis check:*), Bash(npx @pragmatic-labs/praxis sync:*), Bash(praxis check:*), Bash(praxis sync:*)
---

Focus: {{arguments}} — if empty, cover the whole workspace at a high level.

This is the hub-sovereign upkeep pass for a Praxis **workspace**: a meta-repo
with independent git repos cloned beneath it. It sequences the hub's own
upkeep, keeps the hub wiki's cross-repo knowledge current, fans work out to
cloned members in **audit mode only**, and never edits a member repo without
the user's explicit confirmation.

**Planning entry.** Enter this pass in planning mode when the rule's planning
trigger routed here, or when `{{arguments}}` states a planning or
implementation question rather than a general sweep. Under planning entry:
scope step 4's fan-out to one read-only planning workstream per affected
cloned member instead of the full roster; treat steps 2 and 3 as optional
observations, skipped when they don't bear on the question; and collapse
steps 5 and 6 into a single planning synthesis — constraints, validation
commands, risks, and `file:line` evidence for the hub plan — instead of the
consolidated upkeep report. The entire pass runs read-only in this mode: hub
drift (step 2) and wiki staleness (step 3) are reported as proposals only,
and no `sync`, wiki edit, or instruction edit is applied until the user is
out of planning and confirms.

**CLI resolution (all repos).** In the hub and every cloned member, run
`praxis check` when that repo has an available `praxis` command. If `praxis` is
unavailable, immediately fall back to `npx @pragmatic-labs/praxis@latest check`
and continue the pass — a missing local command is not a reason to skip that
repo. Use the matching `praxis sync` or
`npx @pragmatic-labs/praxis@latest sync` invocation if drift needs syncing.
Always pin the fallback to `@latest`; never use a bare
`npx @pragmatic-labs/praxis`, which can silently reuse a stale cached build.

1. **Read the workspace** from `praxis.yaml`'s `workspace:` section (members,
   edges, contract pages). If it is absent, say so and stop — this command is
   for a workspace hub only. Note any member whose directory isn't cloned yet;
   skip it in the steps below and point at that repo's own clone/setup script
   if one exists — never invent one.

2. **Hub pass.** Perform `{{workflow:praxis-upkeep}}` for this repo. Its
   `praxis check` output now includes member-anchor skips and the `Workspace:`
   status line for this hub — read them, don't just exit-code them.

3. **Workspace wiki currency.** Ensure the hub wiki has a system-map page (a
   member table, the dependency edges, a contract-page index, cross-repo change
   order, and an add-a-member checklist) consistent with `workspace:` in
   `praxis.yaml` — the manifest is the source of truth for membership and
   edges; the wiki holds the prose and contracts. Anchor member references with
   `member:` anchors so `praxis check` trips on drift. This is wiki work: follow
   `{{workflow:praxis-wiki}}`'s own conventions and confirmation gate before
   creating or editing pages.

4. **Member fan-out (report-first).** For each **cloned** member — each
   **affected** cloned member only, under planning entry — produce a
   per-member brief with `{{workflow:praxis-handoff}}` and delegate one
   workstream per member — where the tool lacks subagent spawning, execute the
   briefs sequentially instead. Every brief must name the resolved member root
   (the hub root plus the member's declared `path`) and make the delegate's
   first tool action use that root as its working directory; the delegate
   confirms the root it used in its report. Each delegate reads that repo's own
   `CLAUDE.md` and every file under `.claude/rules/` (Claude Code) or
   `AGENTS.md` (Codex/agents-md) first, then `docs/wiki/index.md` when it
   exists and the relevant pages those entrypoints identify, before inspecting
   source.

   When the focus is planning or an implementation question, do not stop at
   methodology currency: state the concrete member-local question in the brief,
   inspect the relevant implementation source and nearest tests, and return the
   constraints, local validation commands, and unresolved risks with `file:line`
   evidence. Keep the workstream in **audit mode**: run `praxis check` there,
   assess instruction/wiki currency, and **return proposed edits without
   applying them**. Also have it flag any duplicated cross-repo integration
   prose that belongs in the hub's contract pages instead.

5. **Edge-based staleness judgment.** For each member with changes since its
   relevant contract page was last touched (compare via `git log`), walk
   `edges` where that member is the producer (`from`) and name each downstream
   member plus its contract page as *likely stale* — a candidate for review,
   not proof.

6. **Consolidated report + apply opt-in.** Report: hub status; a per-member
   table (cloned / onboarded / check result); proposed edits per member;
   likely-stale contract pages; and a recommendation of the form "run
   `{{workflow:praxis-upkeep}}` in `<member>`" for any member whose own upkeep
   needs running. On explicit user confirmation, re-delegate to apply the
   confirmed subset per member, so the user can review each member's own git
   diff. Never edit a member's files without that confirmation.
