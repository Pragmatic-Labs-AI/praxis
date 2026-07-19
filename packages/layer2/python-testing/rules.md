---
paths: ["**/*.py", "**/test_*.py", "**/*_test.py"]
---

## Python test-layer recipe (Layer 2)

Choosing *where* a test belongs matters as much as writing it: pick unit,
integration, or end-to-end by what could actually break — unit for a single
module's logic, integration for real seams (filesystem, a spawned process, a
database), end-to-end for an invariant the whole application must honour.
Then mirror the nearest existing test of that same layer for its location
(`tests/` or alongside), `test_*.py` naming, and `conftest.py` fixtures rather
than inventing a new shape.

Layer 1 rules (think before coding, simplicity first, surgical changes,
goal-driven execution) apply unchanged — this file adds only what is
Python-testing-specific.

- **Plain `assert` with pytest.** Let pytest's assertion rewriting report the
  values; don't wrap checks in `unittest` assert methods or add a second
  runner.
- **Prefer builtin fixtures.** Reach for `tmp_path`, `monkeypatch`, `capsys`
  over hand-rolled setup/teardown code — they clean up after themselves.
- **Parametrize instead of copy-paste.** Use `@pytest.mark.parametrize` for
  the same body run over many inputs, not duplicated test functions.
- **Default fixtures to function scope.** Widen to `module`/`session` scope
  only for an expensive read-only resource; a wider scope shares mutable
  state across tests that expect isolation.
- **Assert error paths with `pytest.raises`.** Use
  `with pytest.raises(Err, match=...)` and assert on the message so the wrong
  error can't pass silently.
