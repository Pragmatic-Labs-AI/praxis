# Wiki change log

Append-only record of durable wiki maintenance, newest last.

## 2026-07-23 updated — methodology pin and sync transaction

Reconciled [decisions](decisions.md) D59/D61 and the
[interaction model](interaction-model.md) with the shipped implementation:
confirmed methodology bumps are targeted YAML edits that join sync as a
required, manifest-first transaction mutation; staging uses the nearest
existing ancestor; external-change detection covers both expected presence and
expected absence.

## 2026-07-24 updated — non-Node installation path

Reconciled the README, [architecture map](architecture-map.md), and
[decisions](decisions.md) D60: Python and other non-Node repositories use an
exact versioned `npm exec --package` invocation in CI and do not need npm
project metadata; the existing lockfile + `npm ci` route remains for npm
repositories.
