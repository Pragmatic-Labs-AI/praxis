## Workspace hub (Layer 2)

This repo is a Praxis **workspace hub**: `workspace:` in `praxis.yaml` declares
the member repos cloned beneath it and the dependency edges between them.

Cross-repo knowledge — dependency edges, API contracts between members,
cross-repo change order, the add-a-new-member checklist — lives in **this
repo's wiki**, never duplicated into member wikis; members carry at most prose
pointers up to it.

Trigger: after any change with cross-repo impact (a producer API change, a new
member, an edge change), or on a periodic sweep, run
`{{workflow:praxis-workspace-upkeep}}` rather than fixing hub/member drift
piecemeal.

Planning trigger: when planning a change that may cross member boundaries, or
when the plan needs member implementation details, enter through
`{{workflow:praxis-workspace-upkeep}}` before finalizing the hub plan. Fan out
one read-only planning workstream per affected cloned member. Every brief names
the resolved member root and makes the delegate's first tool action start there;
the delegate reads that member's `CLAUDE.md` and every file under
`.claude/rules/` (Claude Code) or `AGENTS.md` (Codex/agents-md), plus
`docs/wiki/index.md` and relevant linked pages when present, then inspects the
implementation source and nearest tests. Synthesize the returned constraints,
validation commands, risks, and `file:line` evidence in the hub — never infer
member implementation from hub prose alone.

Sovereignty: never edit a member repo's files from the hub uninvited — audit,
propose, and apply only what the user confirms.
