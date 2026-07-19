---
praxisAnchors:
  - type: path
    target: docs/wiki/decisions.md
  - type: section
    target: docs/wiki/decisions.md#11-decision-record
---
# Decisions — archive

Rows moved out of the [main decision ledger](decisions.md) because they are
fully superseded or purely historical: the decision content has been closed or
re-carried by a named successor row, so the main ledger no longer needs them to
state a live constraint. **D-numbers are immutable** — a row lives here or in the
main ledger, never both, and every `D<N>` citation elsewhere still resolves to
exactly one row. Rows are reproduced verbatim, prefixed with the successor that
superseded them. Archiving is deliberately conservative; the main ledger's
[Decision digest](decisions.md) is the primary overview tool, not this file.

| # | Decision | Status |
|---|----------|--------|
| D17 | **Superseded by [D33](decisions.md#11-decision-record).** `init` ships **minimal** (detect → default manifest → preview → write + apply); Customize UI + devDependency offer deferred until Layer 2 | Settled ([interaction-model](interaction-model.md)) — historical: the Customize deferral was closed by D33 |
