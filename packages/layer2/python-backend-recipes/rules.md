---
paths: ["**/*.py"]
---

## Python backend authoring recipes (Layer 2)

Stack-specific craft for Python backend code. These say *how to add something
well in this stack*; the concrete shape lives in this repo's own prior art, not
here. Find the nearest existing module and mirror it.

Layer 1 rules (think before coding, simplicity first, surgical changes,
goal-driven execution) apply unchanged — this file adds only what is
Python-specific.

- **Follow the repo's packaging conventions.** Match the module layout, import
  style (absolute vs relative), and `src/` vs flat packaging already in use —
  don't introduce a second convention.
- **No mutable default arguments.** A `[]` or `{}` default is shared across
  every call; use a `None` sentinel and build the value inside the function
  body.
- **Never swallow exceptions.** No bare `except:`; catch the narrowest
  exception type and either handle it or re-raise with `raise ... from e` to
  keep the chain.
- **Timezone-aware datetimes.** Use `datetime.now(timezone.utc)`, not naive
  `datetime.now()` — a naive datetime is a latent bug at every boundary it
  crosses.
- **No blocking calls inside `async def`.** `requests`, `time.sleep`, and sync
  DB drivers stall the event loop; use the async equivalent or run it in an
  executor.
- **Parameterized queries only.** Pass values as query parameters; never build
  SQL with f-strings or `%` interpolation.
- **Context managers for resources.** Open files, connections, and locks with
  `with` so they close on every path, including exceptions.
