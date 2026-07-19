---
paths: ["**/*.test.tsx", "**/*.test.jsx", "**/*.spec.tsx", "**/*.spec.jsx"]
---

## React test-layer recipe (Layer 2)

Choosing *where* a test belongs matters as much as writing it: pick unit
render, integration, or end-to-end by what could actually break — a single
component in isolation, two or more components (or a component wired to a
real hook/context/store), or a full user journey in a real browser reserved
for critical paths. Then mirror the nearest existing test's RTL setup,
provider wrapping, runner, and naming rather than inventing a new shape.

Layer 1 rules (think before coding, simplicity first, surgical changes,
goal-driven execution) apply unchanged — this file adds only what is
React-testing-specific.

- **Query by role, label, or text.** Use `getByRole`, `getByLabelText`,
  `getByText` — never CSS class, a test id where a role exists, or internal
  component state. A test that breaks on a classname rename without catching
  a regression is noise.
- **Interactions go through `userEvent`.** Await it
  (`await userEvent.click(...)`); prefer it over `fireEvent`, which skips the
  events real users trigger.
- **Await async UI with `findBy*`.** Use `findByRole`/`findByText` (or
  `waitFor`) for content that appears after an effect; never put a
  side-effecting call inside `waitFor`.
- **Wrap renders with the repo's provider helper.** Mirror how the nearest
  test supplies context, store, or router rather than rendering the bare
  component.
