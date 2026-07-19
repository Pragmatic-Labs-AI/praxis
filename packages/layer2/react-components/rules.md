---
paths: ["**/*.tsx", "**/*.jsx"]
---

## React component authoring recipes (Layer 2)

React-specific craft for component code. General TypeScript/Node craft (types,
module shape, surgical change) lives in `node-recipes` — this file covers only
what is React-specific. The concrete shape lives in this repo's own prior art,
not here. Find the nearest existing component and mirror it.

Layer 1 rules (think before coding, simplicity first, surgical changes,
goal-driven execution) apply unchanged — this file adds only what is
React-specific.

- **Props typed at the boundary.** Every component declares an explicit props
  interface or type at the top of its file. Accept the minimum props needed;
  no catch-all `[key: string]: unknown`.
- **Composition over configuration.** Prefer a small focused component used in
  multiple arrangements over a large one with a boolean-flag API. When a
  component's props grow into a switch statement, split into two components
  that share a common primitive.
- **Native HTML elements before a component library.** A `<button>`,
  `<label>`, or `<ul>` is always the first option. Reach for a library
  component only when the native element demonstrably cannot satisfy the
  requirement — and then use whichever library the repo already imports.
- **Accessibility is non-negotiable.** Every interactive element is reachable
  by keyboard and has a visible focus style. Form inputs have associated
  `<label>` elements. Non-decorative images have descriptive `alt` text.
  Custom interactive elements carry the correct ARIA `role` and `aria-*`
  attributes.
- **Follow the repo's hooks and state conventions.** Use
  `useState`/`useReducer` at the level state is first needed, and lift only
  when a sibling needs it. Don't introduce a new global-state library for a
  single component's needs.
- **You might not need an effect.** Derive values during render instead of
  mirroring props/state into state; an effect is for synchronizing with an
  external system, not for computing from existing state.
- **Name the effect callback.** `useEffect(function syncScrollPosition() { … },
  [deps])` — a named function makes the effect's intent legible and gives it a
  real name in stack traces and React DevTools instead of an anonymous arrow.
- **Every subscription effect returns its cleanup.** A listener, timer, or
  subscription set up in an effect is torn down in the function the effect
  returns.
- **`key` is stable identity, not the array index.** Keys must survive
  reordering; index keys corrupt state on insert or remove.
- **No `memo`/`useMemo`/`useCallback` by default.** Add memoization only
  against a measured problem; premature memoization is complexity with no
  payoff.
