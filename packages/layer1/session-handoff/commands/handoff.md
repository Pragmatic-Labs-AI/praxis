---
description: Capture full session context into a chronologically-named, self-contained handoff document so a fresh session can resume the work without re-running discovery.
argument-hint: [optional-topic-slug]
allowed-tools: Read, Glob, Grep, Bash(git status:*), Bash(git branch:*), Bash(git diff:*), Bash(git log:*), Bash(date:*), Bash(ls:*), Bash(mkdir:*), Write
---

# Session Handoff Document

You are a senior engineer writing a handoff document at the end of a working
session. Capture ALL relevant context so a fresh session — with none of this
conversation in memory — can read the file and immediately continue the work.

The handoff is a **context cache, not just a status report.** Whoever reads it —
with none of this conversation in memory — should be able to act from it without
re-running the discovery you already did. Provide or reference the load-bearing
context — files, line numbers, doc sections, prior art, commands — rather than
making the reader rediscover it.

The brief serves two readers, and the same document works for both:
- **A fresh session** a human starts later to resume the work.
- **A subagent** the orchestrator dispatches *now* to execute a scoped
  workstream (see *Delegation mode* below).

## Delegation mode

By default this command writes one combined handoff for resuming the whole task.
Switch to delegation mode — **one scoped brief per workstream** instead of a
single combined doc — when you intend to delegate execution, for either reason
(they don't require parallelism):
- the work splits into **independent workstreams** to run concurrently, or
- a **context-heavy or sequential** stream is worth running in an execution
  agent's *own* context (and on a lighter tier) to keep the orchestrator's clean.

- Write one brief per workstream — including a single sequential stream worth
  isolating. Run Phases 1–5 per brief, scoped to that workstream only (its files,
  prior art, commands, success criterion), so an execution agent runs it cold.
- Name each file for its workstream: `YYYY-MM-DD_HHMM_HANDOFF_<workstream>.md`, so
  the set sorts together and each is identifiable.
- Keep workstreams at the right grain: independent ones don't coordinate
  mid-flight; a sequential stream is one brief the agent works start to finish.

Everything else (sections, discipline, save location) is identical to the
single-doc flow below.

## Phase 1 — Build the filename

Read the clock so the name sorts chronologically (do not guess the time):

- Timestamp: {{shell:date +%Y-%m-%d_%H%M}}

Build the filename `YYYY-MM-DD_HHMM_HANDOFF_<topic>.md`:
- `<topic>` is a short kebab-case slug for the work. Use {{arguments}} if
  provided; otherwise derive it from the task.
- Date-and-time first means a plain alphabetical listing is chronological.

## Phase 2 — Gather context

Analyze this conversation for:
- The task/feature/bug being worked on
- Files read, created, modified, deleted
- Key decisions and their rationale
- Problems hit and how they were solved
- What is done vs pending
- Open questions and blockers

Then, crucially, harvest from **your own session** the pointers a fresh session
would otherwise have to rediscover — the files you Read, the searches you ran,
the docs you consulted, the commands you found. These go in the *Context map &
references* section below. Don't re-derive them; you already paid for them.

## Phase 3 — Project state

If in a git repo, capture current branch, staged/unstaged changes, and recent
commits from this session:

- Branch: {{shell:git branch --show-current 2>/dev/null}}
- Status: {{shell:git status --short 2>/dev/null}}
- Recent commits: {{shell:git log --oneline -10 2>/dev/null}}

Capture verification state too: identify the project's own build/test/lint
commands (from its config / docs / CI) and record their current result — what
passes, what fails, what is untested. Use whatever the project actually has;
don't assume a specific toolchain.

## Phase 4 — Choose save location

Save to the first of these that exists (create the dir if needed):
1. `docs/handoffs/`
2. `docs/`
3. `.claude/handoffs/` (create the `handoffs` subdir)
4. project root (fallback)

Run `mkdir -p` on the chosen directory before writing.

## Phase 5 — Write the document

Write the file using the Write tool. NEVER just print it to chat — it must be
saved to disk. Use this structure:

````markdown
# Handoff: [Brief Title]

> **RESUMING SESSION:** If you are a fresh session reading this file, your job is
> to continue the work described below. Read "Context Map & References" first so
> you can act without re-running discovery, then start at "Immediate Next Steps"
> and verify current state against the repo before proceeding.

**Created:** [timestamp]
**Branch:** [branch]

## Summary
[2–3 sentence executive summary: what was being worked on and current state.]

## Context Map & References
*The resume-time context cache — populate this so the next session skips
re-discovery. Be generous here; a pointer that saves a re-search earns its
bytes.*

### Key files
- `path:line-range` — why it matters (what to read / change here)

### Reference material
- [Project design/decision/architecture doc] §section — what it says that matters
- [External link / ticket / spec] — relevance

### Prior art / templates to mirror
- `path` — the pattern to copy for the pending work

### Commands
```bash
[exact build / test / run / lint invocations for this project]
```

### Search anchors
- `grep/symbol/query` — what it locates (so re-search is cheap)

### Critical excerpts
[Short snippets of the few load-bearing pieces, so the next session often need
not reopen the file.]

## Work Completed
- [ ] [Specific change 1]
- [ ] [Specific change 2]

### Key Decisions
| Decision | Rationale | Alternatives |
| --- | --- | --- |
| ... | ... | ... |

## Files Affected
### Created
- `path` — purpose
### Modified
- `path` — what changed and why (functions/lines if relevant)
### Deleted
- `path` — why

## Technical Context
[Architecture notes, patterns, new dependencies, config/env changes.]

## Current State
### Working
- ...
### Not working
- [issue — suspected cause]
### Verification
- [ ] Build: [status]
- [ ] Tests: [status / which command]
- [ ] Lint/typecheck: [status]
- [ ] Manual: [what was tested]

## Immediate Next Steps
1. [Most critical next action — be specific]
2. [Second priority]
3. [Third priority]

## Blocked On
- [Blocker + how to unblock]

## Open Questions
- [ ] [Question 1]
- [ ] [Question 2]

## Instruction-layer follow-up
- [Did this session change the project in a way that makes its authored
  instruction files (agent-instruction docs / rules) stale or incomplete? If so,
  what needs updating — and via the project's own upkeep path, not silently.]
````

## Constraints
- Keep the prose sections concise; the *Context Map & References* section may be
  as long as it needs — prioritize actionable, copy-pasteable pointers over
  narrative.
- Use real file paths, function names, line numbers.
- Present tense for current state, future tense for next steps.
- The "Immediate Next Steps" and "Context Map & References" sections are
  mandatory and must be specific.

## Phase 6 — Confirm and hand off

**Resume path (single combined handoff).** After writing, print exactly this to
chat (with real values substituted):

```
✅ Handoff saved: <relative/path/to/file.md>

To continue, open a NEW session and send:
  Read <relative/path/to/file.md> and continue from the Immediate Next Steps section.
```

Starting a new top-level session is a manual step — do not try to launch one;
the user does that.

**Delegation path (per-workstream briefs).** After writing the briefs, print the
dispatch list so the orchestrator can fan the work out — one subagent per brief:

```
✅ Briefs saved:
  - <relative/path/to/workstream-a.md>
  - <relative/path/to/workstream-b.md>

To execute, dispatch one subagent per brief:
  Read <brief> and complete the workstream it describes; verify against its
  success criterion before returning.
```

Spawning a subagent for each brief and verifying its result on return is the
orchestrator's job (the main thread, which has the subagent/Task tool) — this
command only produces the briefs. Within-session subagent delegation is
supported; launching a separate top-level session is not.
