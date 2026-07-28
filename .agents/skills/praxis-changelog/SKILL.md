---
name: praxis-changelog
description: "Record user-visible changes in CHANGELOG.md, or promote the accumulated Unreleased section into a dated release entry."
---

Scope: the arguments supplied with this skill

This maintains **consumer-facing release communication** — what a release
brings and what it asks of the people upgrading. It is not the project's
internal knowledge wiki and not a session handoff; do not duplicate either
into it.

Two modes. Infer which from the scope above and from repository state; when
genuinely ambiguous, ask.

- **Record** (the common case) — add entries for work just completed.
- **Release** — promote `Unreleased` into a dated version entry.

## Format

Follow [Keep a Changelog](https://keepachangelog.com/) with one addition:

- Newest first. An `Unreleased` section sits at the top.
- Group entries under `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
  `Security`. Omit empty groups.
- **Every released version also carries an `Upgrading` note** — the addition.
  Keep a Changelog has no such category, and it is the one thing a consumer
  needs before upgrading. State the prerequisite or required edit, or say
  plainly that there is none.
- Write for someone who did not make the change: name the user-visible effect,
  not the implementation. Link issues/PRs where the project already does.

## Record

1. Establish what is new: read `CHANGELOG.md` if it exists (create it from the
   format above if not), and identify the last released version. Inspect what
   changed since — `git log`, `git diff --stat`, the current branch's commits.
2. Keep **only user-visible changes**. A refactor, a test, or an internal
   rename with no observable effect does not belong in a changelog; say so
   rather than padding the entry. If nothing user-visible changed, report that
   and write nothing.
3. Draft entries under the right groups, in the project's existing voice and
   tense. Match the surrounding entries; do not restyle the file.
4. If any change alters what an upgrade requires — a raised runtime floor, a
   renamed or removed setting, a manual migration step — draft the `Upgrading`
   note now, while the reason is known.
5. **Show the draft and ask before writing.** Confirm the entries and the
   classification.
6. Write the confirmed entries under `Unreleased` and report what was added.

## Release

1. Determine the version being released and confirm it against the project's
   own source of truth (a manifest version field, a tag convention). Do not
   invent a number; ask if it is not derivable.
2. Replace the `Unreleased` heading with the version and the release date
   (`YYYY-MM-DD`), and open a fresh empty `Unreleased` above it.
3. Ensure the `Upgrading` note is present and accurate for the whole release,
   not just the last change. When the release asks nothing unusual, say so
   explicitly in one line — an absent note is indistinguishable from a
   forgotten one.
4. Re-read the assembled entry as a consumer who is deciding whether to
   upgrade. Fix anything that only makes sense to the author.
5. **Show it and ask before writing.** Then write, and report what to do next
   in this project's release process (tag, publish, release notes) without
   performing those steps unless asked.
