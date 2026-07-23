/**
 * Methodology version resolution (A1, docs/wiki/decisions.md D6/D42). Identity
 * is the exact `@pragmatic-labs/praxis` package version (Option 1): the
 * `packages/` tree shipped inside a given release *is* that release's
 * methodology content, so pinning the CLI and pinning the methodology are the
 * same act. Pre-1.0, this is an **exact-version match**, not a semver range —
 * every `0.x` bump is convention-eligible for a breaking change, so a
 * "compatible range" concept would presume a stability contract Praxis hasn't
 * made yet.
 *
 * Pure function of two strings — no filesystem, no network (D12) — so it is
 * trivially unit-testable and cannot, even by accident, become a place an LLM
 * or a fetch gets involved in what a repo installs.
 */

/** `manifest.methodology` names a version the running Praxis CLI cannot
 *  satisfy: either it isn't a valid version at all, or it names a release
 *  newer than the one currently running (the repo asks for content this CLI
 *  does not have). Always a hard failure — there is nothing to offer. */
export class MethodologyIncompatibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MethodologyIncompatibleError";
  }
}

/** The running Praxis CLI is newer than the pinned `manifest.methodology`
 *  (the common case: someone upgraded their global/npx Praxis). Distinct from
 *  `MethodologyIncompatibleError` so interactive `sync` can catch it and offer
 *  an explicit confirm-to-bump instead of failing outright; `check` and any
 *  non-interactive caller still treat it as a hard failure. */
export class MethodologyUpgradeAvailableError extends Error {
  constructor(
    public readonly pinned: string,
    public readonly running: string,
  ) {
    super(
      `praxis.yaml pins methodology "${pinned}", but the running Praxis is ${running} (newer).\n` +
        "Run `praxis sync` to review and accept the update, or edit `methodology:` " +
        `in praxis.yaml to "${running}" yourself.`,
    );
    this.name = "MethodologyUpgradeAvailableError";
  }
}

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** Parses the numeric `major.minor.patch` core of a version string (an
 *  optional `-prerelease`/`+build` suffix is accepted but ignored for
 *  comparison — Praxis releases don't use one today). Returns `undefined` for
 *  anything else, e.g. "not-a-real-version". */
function parseVersion(version: string): SemVer | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** -1 if `a` < `b`, 0 if equal, 1 if `a` > `b`. */
function compareVersions(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/**
 * Resolve a manifest's pinned `methodology:` against the running CLI's own
 * version. Equal: no-op. Otherwise throws — never silently proceeds:
 *
 * - `pinned` unparseable, or `pinned` newer than `running`: `MethodologyIncompatibleError`.
 * - `pinned` older than `running` (and a valid version): `MethodologyUpgradeAvailableError`.
 */
export function resolveMethodology(pinned: string, running: string): void {
  if (pinned === running) return;

  const pinnedVersion = parseVersion(pinned);
  if (!pinnedVersion) {
    throw new MethodologyIncompatibleError(
      `praxis.yaml pins methodology "${pinned}", which is not a valid version.\n` +
        `The running Praxis is ${running}. Set \`methodology: "${running}"\` in praxis.yaml, ` +
        "or install the Praxis release this repo was authored against.",
    );
  }

  const runningVersion = parseVersion(running);
  if (!runningVersion || compareVersions(pinnedVersion, runningVersion) > 0) {
    throw new MethodologyIncompatibleError(
      `praxis.yaml pins methodology "${pinned}", which is newer than the running Praxis (${running}).\n` +
        `Upgrade your Praxis install to >= ${pinned} to use this repo.`,
    );
  }

  throw new MethodologyUpgradeAvailableError(pinned, running);
}

/** The manifest's raw text has no `methodology:` line for `setMethodologyInYaml`
 *  to rewrite — there is nothing safe to edit in place. */
export class MethodologyLineNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MethodologyLineNotFoundError";
  }
}

// Matches the whole `methodology:` line: optional leading indentation, the
// key, its value (double-quoted, single-quoted, or a bare token — never
// spanning a `#`), and everything after the value verbatim (spacing plus an
// optional trailing inline comment). Anchored per-line via `m` so it matches
// regardless of where the key appears in a hand-edited file.
const METHODOLOGY_LINE = /^([ \t]*methodology:[ \t]*)("[^"]*"|'[^']*'|[^\s#]+)([ \t]*(?:#.*)?)$/m;

/**
 * Rewrite only the `methodology:` value in a manifest's raw YAML text (D59's
 * interactive `sync` confirm-to-bump). A targeted single-line text edit, not a
 * parse/re-render round-trip: `renderManifestYaml` (src/init.ts) rebuilds the
 * whole file canonically and would silently destroy a hand-edited
 * `praxis.yaml`'s comments, block-style `packages:`, quoting, or field order.
 * This function touches only the matched line's value, preserving that line's
 * own indentation and quote style (and any trailing inline comment) and every
 * other line byte-for-byte. Throws `MethodologyLineNotFoundError` if no
 * `methodology:` line is present.
 */
export function setMethodologyInYaml(rawText: string, newVersion: string): string {
  const match = METHODOLOGY_LINE.exec(rawText);
  if (!match) {
    throw new MethodologyLineNotFoundError(
      'Could not find a "methodology:" line in praxis.yaml to rewrite.',
    );
  }
  const whole = match[0];
  const prefix = match[1] ?? "";
  const value = match[2] ?? "";
  const trailing = match[3] ?? "";
  const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : "";
  const replacement = `${prefix}${quote}${newVersion}${quote}${trailing}`;
  return rawText.slice(0, match.index) + replacement + rawText.slice(match.index + whole.length);
}
