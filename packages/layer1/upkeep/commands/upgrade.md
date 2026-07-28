---
description: Upgrade Praxis itself — check for a newer release, read what it asks of you, then move the CLI pin and praxis.yaml's methodology pin together.
---

Scope: {{arguments}}

`praxis.yaml`'s `methodology:` must equal the version of the Praxis CLI that
runs against it (exact match while pre-1.0). Those are **two pins in two
places**, and moving only one fails the gate — loudly, in either direction.
This command moves both, in the right order.

Never upgrade unprompted; the user decides. If the registry is unreachable,
say so and stop — do not guess at versions.

1. **Compare.** Read the pinned version from `praxis.yaml`, the running CLI's
   version (`praxis --version`), and the latest published release
   (`npm view @pragmatic-labs/praxis version`).
   - All three equal: report "already current" and stop.
   - Pinned is *newer* than the running CLI: this is not an upgrade — the repo
     was authored against a newer Praxis than is installed. Install the
     matching release instead, and stop.
2. **Read what the new version asks.** Fetch that version's entry from the
   project's `CHANGELOG.md` — in particular its **Upgrading** note, which
   states any prerequisite or required edit. Summarize for the user: what the
   release brings, and whether it needs anything beyond the normal steps.
   Say so plainly if no notes are published for that version rather than
   assuming the upgrade is routine.
3. **Confirm with the user** before changing anything, naming the target
   version and any prerequisite from step 2.
4. **Satisfy prerequisites first**, if step 2 named any — a raised runtime
   floor, a renamed package identity in `packages:`, a removed setting. An
   upgrade that skips these fails later and less clearly.
5. **Move the CLI pin**, using whichever install path this repo already uses —
   do not switch it to another:
   - exact `devDependency` + lockfile → update the version, then `npm ci`
   - a versioned `npm exec --package=@pragmatic-labs/praxis@<version>` in CI →
     update that version string
   - a global or `npx` install → install the target version exactly
6. **Move the methodology pin**: set `methodology:` in `praxis.yaml` to the same
   version. Edit only that value — preserve the file's comments, field order,
   and quoting.
7. **Reconcile**: run `praxis sync`. Both pins now agree, so it proceeds and
   re-emits the methodology layer.
8. **Verify and report.** Run `praxis check` and the project's own gates.
   Review the re-emitted diff with the user — call out any file left as a
   conflict, and note explicitly when no emitted file changed (a pin-only
   upgrade is a safe upgrade). Do not commit unless asked.
