---
paths: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs"]
---

## Node/TypeScript authoring recipes (Layer 2)

Stack-specific craft for TypeScript/Node code. These say *how to add something
well in this stack*; the concrete shape lives in this repo's own prior art, not
here. Find the nearest existing example and mirror it.

Layer 1 rules (think before coding, simplicity first, surgical changes,
goal-driven execution) apply unchanged — this file adds only what is
Node-specific.

- **ESM vs CJS, follow the repo.** Match the module system, `.js` import
  specifiers under `"type": "module"`, and the `tsconfig` target already in
  use — don't introduce a second convention.
- **Every promise is handled.** `await` it, `return` it, or explicitly `void`
  it with a comment explaining why. A floating promise swallows its rejection
  and its ordering.
- **Never silence the type checker.** No `any`, no `as` cast, no non-null `!`
  to make an error disappear. Fix the type; a suppressed error is a runtime
  bug deferred.
- **Prefer the platform before a dependency.** `node:`-prefixed builtins
  (`node:fs/promises`, `node:path`, `node:crypto`) and global `fetch` cover
  most needs; justify a new dependency against what neighbouring files
  already import.
- **Throw `Error` subclasses, never strings.** Attach `cause` when
  re-throwing, and handle `error` events on child processes and streams — an
  unhandled one crashes the process.
- **Validate untrusted input where it enters.** Use the repo's validator
  (e.g. zod) with a non-throwing parse (`safeParse`-style) at the boundary;
  don't re-validate data already typed and checked upstream.
