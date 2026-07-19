## Instruction upkeep

The authored agent instruction layer drifts as a
project changes. When it goes stale, incomplete, or a misunderstanding
surfaces, fix it — checking coverage against: build/test/run commands ·
layout · conventions · always-do rules.

When multiple first-class targets are selected, audit every native project
instruction surface. Shared project sections must remain consistent; native
target-specific sections may differ.

Make changes through `/praxis-instructions`, not ad-hoc edits. When
reconciling the methodology layer after a change, enter through
`/praxis-upkeep` (which delegates here) instead of running this pass alone.
