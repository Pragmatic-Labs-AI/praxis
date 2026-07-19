---
praxisAnchors:
  - type: command
    target: npm run typecheck
  - type: command
    target: npm run build
  - type: command
    target: npm test
  - type: command
    target: npm run conformance
  - type: command
    target: npm run selfcheck
  - type: path
    target: .github/workflows/ci.yml
  - type: path
    target: .github/workflows/dco.yml
  - type: path
    target: .github/workflows/release.yml
---
# Workflows — build, test, conventions

Canonical: `CLAUDE.md` "Working in this repo". This page is the quick reference.

## Commands (run in this order — it's the CI order too)

| Command | What |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | `tsc -p tsconfig.build.json` → `dist/` |
| `npm test` | vitest over `test/` (unit tests mirroring `src/`) |
| `npm run conformance` | vitest over `conformance/` (the CI-gated suite) |
| `npm run selfcheck` | `node dist/cli.js check` — `praxis check` against this repo's own emitted files |

`.github/workflows/ci.yml` runs all five, in that order, on every push to `main`
and every PR. Before them, CI also runs `npm install -g @openai/codex` — without
it, `conformance/codex.conformance.test.ts`'s `codex execpolicy check` assertion
silently skips (`it.skipIf(!codexAvailable)`), and the "output is valid for that
tool" half of the Tool-neutral rail (CLAUDE.md) never actually runs.

Two more workflows run alongside `ci.yml`:

- **`.github/workflows/dco.yml`** — on every PR, checks that each non-merge
  commit carries a `Signed-off-by:` trailer (DCO) and fails with the missing
  commits listed. Sign off with `git commit -s`. See `CONTRIBUTING.md`.
- **`.github/workflows/release.yml`** — the release/publish path (below), not a
  per-PR gate; it triggers only on a `v*` tag.

## Release / publish (D32 → D57)

Praxis is published to **public npm** as the scoped package
`@pragmatic-labs/praxis`, so `npx @pragmatic-labs/praxis` runs it on any machine
(D32). `package.json` carries `publishConfig.access: public` (scoped packages
default to restricted) and `files: [dist, packages, …]`; `dist/` is gitignored
and built fresh at publish via `prepublishOnly`. Verify packaging with
`npm pack --dry-run`.

The **release boundary** (D57) makes `.github/workflows/release.yml` the sole
publish path, replacing a human `npm login && npm publish`:

- Triggers only on a `v*` **tag** push, runs in a protected `release`
  environment (a required reviewer), and first guards that the pushed tag equals
  `v` + `package.json` version.
- Re-runs all five gates against the tagged commit, then verifies the `npm pack`
  file allowlist (every packed file must live under `dist/`/`packages/` or be a
  named root file).
- Publishes via **npm trusted publishing (OIDC)** with automatic provenance —
  **no npm token anywhere** (`id-token: write`). Node 22 + npm 11.5.1 are pinned
  per npm's trusted-publishing requirement.

The workflow is **inert until the console-side setup exists** (the npm
trusted-publisher binding, `release`-environment reviewers, and npm
2FA-required/tokens-disabled), all enumerated in the workflow's own header
comment; until then a tag push cannot publish and there is no token fallback.

**First-publish bootstrap (D58):** npm can only bind a trusted publisher to a
package that already exists on the registry, so `@pragmatic-labs/praxis`'s
first-ever publish cannot go through this workflow. That one publish is a
recorded manual owner step — `npm publish` with a short-lived granular token
and 2FA — followed immediately by the trusted-publisher binding (allowed
action selected; `package.json` `repository.url` must exactly match the
GitHub repo) and revocation of the temporary token. From the second release
on, `release.yml` is again the sole publish path.

## Conventions (non-negotiable — CLAUDE.md)

- **Harness before features.** No feature code lands before its enforcement
  skeleton exists (conformance test + CI gate). A rule that matters has a test; a
  rule that lives only in prose will be violated.
- **Prior art is the template.** No scaffold generator. To add something, mirror
  the nearest existing example; conformance catches deviations.
- **Branch → PR → CI green → merge.** Work lands on a feature branch and merges to
  `main` via PR — **no direct pushes to `main`**. One PR per phase; check
  `git branch --show-current` before any commit.
- **Methodology, not implementation.** Praxis writes only the methodology layer;
  if a change makes it install app infrastructure into a target, it's out of scope.
- **Conformance failures are the prompt.** Failure messages are written for the
  agent to self-correct: what's missing, where to add it, which prior-art file to
  follow.

## Self-hosting

Praxis has its own `praxis.yaml` (`stacks: [node]` — it dogfoods the `node`
Layer 2 stack on its own TS sources; `targets: [claude-code, codex, agents-md]`;
`packages: [karpathy-claude, safe-permissions, instruction-upkeep,
session-handoff, wiki-memory, upkeep, node-recipes, node-testing, ponytail,
drawio]`) and dogfoods its own methodology. `npm run selfcheck` in CI means changing
the methodology source without re-syncing fails the build. ([self-hosting](self-hosting.md).)
