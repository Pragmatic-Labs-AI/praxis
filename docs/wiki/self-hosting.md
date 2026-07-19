---
praxisAnchors:
  - type: path
    target: praxis.yaml
  - type: command
    target: npm run selfcheck
  - type: section
    target: docs/wiki/decisions.md#11-decision-record
---
# Self-hosting (dogfooding)

Praxis enforces its own methodology on itself. The milestone that proves the
emit/merge slice works: **Praxis emits its own `AGENTS.md` and per-tool files
from its own methodology source**, and `praxis check` passes in its own CI.

**Achieved.** Praxis has its own `praxis.yaml` (`targets: [claude-code, codex,
agents-md]`, `stacks: [node]`, and all Layer 1/Node dogfood packages). `praxis
sync` emits Claude rules/settings/commands, the `AGENTS.md` managed blocks,
Codex repo skills, a permission profile and command rules, and the verified
Ponytail marketplace entry;
`npm run selfcheck` (= `praxis check`) runs in CI, so changing the methodology
source without re-syncing fails the build. Praxis also keeps its project-owned
facts in peer `praxis:shared-project` blocks in `CLAUDE.md` and `AGENTS.md`;
selfcheck verifies exact parity without making either file canonical. Praxis
dogfoods every commands
package it ships (`instruction-upkeep`/D22, `session-handoff`/D24,
`wiki-memory`/D25, `upkeep`/D29) and every external plugin-marketplace package
(`ponytail`/`drawio`, D28) — proof the commands and plugin emitters work, not
just that their conformance tests pass.

The same five gates also gate the **public snapshot** (D56): the sanitized,
allowlisted tree built for the eventual public release is required to pass all
five — `selfcheck` included — before it can ship, so the dogfooding extends to
the public boundary itself. Its `selfcheck` anchor count is lower than this
repo's because withheld pages carry no anchors, which is expected, not a defect.

See [interaction-model](interaction-model.md) for `sync`/`check`, and
[packages-and-emit](packages-and-emit.md) for how `packages` resolves to
files.
