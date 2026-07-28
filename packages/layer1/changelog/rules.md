## Changelog

A release that ships without a record of what changed forces every consumer to
read diffs or guess. Keep a `CHANGELOG.md`: consumer-facing release
communication — a different audience from the knowledge wiki (the project's own
durable memory) and from a handoff (transient session context).

When a change alters user-visible behavior — a flag, an output, a default, a
requirement, a removal — record it under `Unreleased` by running
`{{workflow:praxis-changelog}}`, not by hand-editing. Recording at the time of
the change is the point; reconstructing a release's contents afterwards from
git history is guesswork.

Every released version carries an **Upgrading** note stating what the upgrade
asks of a consumer — a prerequisite, a required edit, or explicitly nothing.
Consumers and agents read that note to decide whether an upgrade is routine.
