---
paths: ["**/*.ts", "**/*.tsx", "**/*.test.ts", "**/*.spec.ts"]
---

## Node/TypeScript test-layer recipe (Layer 2)

Choosing *where* a test belongs matters as much as writing it: pick unit,
integration, or conformance/end-to-end by what could actually break —
unit for a single module's logic, integration for real seams (filesystem, a
spawned process, a built artifact), conformance/e2e for rails the whole tool
must honour. Then mirror the nearest existing test of that same layer for its
runner, file location, naming, and fixtures rather than inventing a new shape.

Layer 1 rules (think before coding, simplicity first, surgical changes,
goal-driven execution) apply unchanged — this file adds only what is
Node-testing-specific.

- **One runner in `package.json`.** Use whichever of vitest or jest the repo
  already has; don't add a second runner or a new assertion library for what
  plain `expect` calls already cover.
- **Await the assertion chain.** `await` or `return` a promise-returning
  assertion (e.g. `expect(promise).rejects...`) — a test whose promise
  resolves after the test function returns asserts nothing and passes falsely.
- **Restore fake timers.** Pair `vi.useFakeTimers()`/`jest.useFakeTimers()`
  with a restore in teardown, and never mix fake timers with a real
  `setTimeout` await inside the same test.
- **Reset mocks between tests.** No shared mutable module state leaking across
  cases; restore spies/mocks in `afterEach` so test order can't change the
  outcome.
- **Temp dir for real-filesystem tests.** Use `fs.mkdtemp` (or the repo's tmp
  helper) and clean up in teardown; never write into the repo tree or a fixed
  path on disk.
