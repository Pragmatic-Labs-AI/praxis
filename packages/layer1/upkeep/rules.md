## Upkeep

The methodology layer (instructions, wiki, emitted agent files) drifts
from project reality like code drifts from docs. When work reveals drift, or
produces new durable knowledge to file, run `{{workflow:praxis-upkeep}}` — the single
front gate sequencing `praxis check`, `{{workflow:praxis-instructions}}`, and
`{{workflow:praxis-wiki}}` — rather than fixing it ad hoc or piecemeal.

When Claude Code and Codex coexist, this gate covers both native instruction
surfaces. Keep their project-owned shared sections synchronized while preserving
target-specific guidance; never make one surface import or replace the other.

Run all three passes through the gate even when only one looks like it has
work — skipping straight to a sub-skill is the piecemeal use this rule
prevents.

When `praxis` is not on PATH, the invocation is
`npx @pragmatic-labs/praxis@{{methodology}} check` — pinned to this repo's
`methodology:`, never `@latest` or a bare `npx`.

Praxis itself also goes stale. At the start of work, check whether a newer
Praxis release exists; if one does, say so and offer `{{workflow:praxis-upgrade}}`.
Never upgrade unprompted, and skip silently when the registry is unreachable —
an offline session must not be blocked or nagged.
