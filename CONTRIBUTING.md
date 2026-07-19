# Contributing to Praxis

Thanks for considering a contribution. Praxis installs a **methodology
layer** — agent instructions, permission policy, and plugin metadata — into
consumer repositories, so changes here are held to the same bar as any tool
that shapes what an AI coding agent is permitted or induced to do. Read
[`CLAUDE.md`](CLAUDE.md) first; it is the canonical statement of how this
repo works and takes precedence over anything below if the two disagree.

## Prior art is the template

**There is no scaffold generator and there will not be one.** To add
anything — a package, an emitter, a conformance test, a rule — find the
closest existing example in this repo and mirror its shape. This is not a
style preference: it is how correctness gets checked here. Praxis shifts the
review burden from "did the contributor follow the rules" (hard to verify)
to "did the contributor mirror the prior art" (verifiable by diffing against
it). If you can't find prior art for what you're adding, open an issue before
writing code — it may need an architecture decision first.

## The conformance suite is the reviewer

Praxis's architectural invariants — the rules in `CLAUDE.md` and the
[design wiki](docs/wiki/index.md) that prose alone can't enforce — are
pinned by tests in `conformance/`, not by trusting a human reviewer to catch
drift. As `conformance/README.md` puts it:

> A conformance failure is read by the coding agent that caused it, and it
> must be enough to self-correct from — with no other context.

**The failing test is the prompt.** If your change breaks a conformance
test, the failure message tells you what invariant broke, where to fix it,
and which prior-art file or decision governs the change. A new package,
emitter, or invariant ships with a test at the layer that enforces it —
`test/` for "does this function do the right thing," `conformance/` for
"does the repo still obey the architecture."

## Before you open a pull request

Run the same five gates CI runs, in this order:

```bash
npm run typecheck
npm run build
npm test
npm run conformance
npm run selfcheck
```

All five must be green. `selfcheck` in particular catches drift between
Praxis's own methodology source and the files it has emitted into this
repo (Praxis self-hosts — it installs its own methodology and gates drift in
its own CI).

## Workflow

- Work on a feature branch; never push directly to `main`.
- Open a pull request against `main`. It merges only once CI is green and
  the change has been reviewed.
- Keep changes surgical: touch only what the task requires, match the
  existing style, and mirror the nearest prior art rather than introducing a
  new pattern.

## Sign off your commits (DCO)

Praxis accepts contributions under the [Developer Certificate of
Origin](https://developercertificate.org/) instead of a CLA. Every commit in
a pull request must carry a `Signed-off-by` trailer certifying you wrote it
or otherwise have the right to submit it under this project's license. Add
it with:

```bash
git commit -s
```

If you forgot on an already-open PR, add sign-off after the fact:

```bash
git commit --amend -s        # last commit only
git rebase --signoff main    # every commit on the branch
```

then force-push the branch. A dedicated CI check (`.github/workflows/dco.yml`)
verifies every non-merge commit in the pull request carries the trailer and
fails the PR with the missing commits listed if one doesn't.

## Reporting security issues

**Do not open a public issue for a suspected vulnerability.** See
[`SECURITY.md`](SECURITY.md) for the private reporting channel and response
targets.

## Code of Conduct

Participation in this project is governed by the
[Contributor Covenant](CODE_OF_CONDUCT.md). Report unacceptable behavior to
the contact named there.

## A note on review time

Praxis currently has a single maintainer. Reviews may take a few days —
thank you for your patience.
