## Upkeep

The methodology layer (instructions, wiki, emitted agent files) drifts
from project reality like code drifts from docs. When work reveals drift, or
produces new durable knowledge to file, run `/praxis-upkeep` — the single
front gate sequencing `praxis check`, `/praxis-instructions`, and
`/praxis-wiki` — rather than fixing it ad hoc or piecemeal.

When Claude Code and Codex coexist, this gate covers both native instruction
surfaces. Keep their project-owned shared sections synchronized while preserving
target-specific guidance; never make one surface import or replace the other.

Run all three passes through the gate even when only one looks like it has
work — skipping straight to a sub-skill is the piecemeal use this rule
prevents.
