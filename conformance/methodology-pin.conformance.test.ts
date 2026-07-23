import { describe, expect, it } from "vitest";
import { planEmit } from "../src/emit.js";
import { parseManifest } from "../src/manifest.js";
import { MethodologyIncompatibleError, MethodologyUpgradeAvailableError } from "../src/methodology.js";
import { praxisVersion } from "../src/version.js";

/**
 * Conformance: `manifest.methodology` is enforced, not merely shape-checked
 * (A1, docs/wiki/decisions.md D6/D42). Identity is the exact running Praxis
 * CLI version (Option 1) — a manifest that names any other version, valid or
 * not, must fail loud rather than silently plan today's bundled methodology.
 *
 * This inverts the bug's own reproduction: before the fix,
 * `parseManifest("...methodology: not-a-real-version...")` followed by
 * `planEmit(m, cwd)` returned `["AGENTS.md"]` — a bogus pin was silently
 * accepted. Case 1 below is that exact command shape; it must now throw.
 */

function manifestYaml(methodology: string): string {
  return (
    "version: 1\n" +
    `methodology: ${JSON.stringify(methodology)}\n` +
    "targets: [agents-md]\n" +
    "packages: [karpathy-claude]\n"
  );
}

describe("conformance: methodology version enforcement", () => {
  it("1. bogus version — the exact §7 reproduction — makes planEmit throw instead of silently planning", () => {
    const guidance = [
      `A bogus \`methodology:\` pin (e.g. "not-a-real-version") must make planEmit`,
      `(src/emit.ts) throw, not silently return the running CLI's bundled output.`,
      `Wire resolveMethodology(manifest.methodology, praxisVersion()) as planEmit's`,
      `up-front validation (src/methodology.ts).`,
    ].join("\n");

    const manifest = parseManifest(manifestYaml("not-a-real-version"));
    expect(manifest.methodology, guidance).toBe("not-a-real-version");
    expect(() => planEmit(manifest, process.cwd()), guidance).toThrow(MethodologyIncompatibleError);
  });

  it("2. a methodology pin matching the running CLI plans normally (positive control)", () => {
    const manifest = parseManifest(manifestYaml(praxisVersion()));
    const guidance = `A methodology pin equal to the running CLI's own version must not be treated as drift.`;
    expect(() => planEmit(manifest, process.cwd()), guidance).not.toThrow();
    expect(planEmit(manifest, process.cwd()).map((op) => op.path), guidance).toContain("AGENTS.md");
  });

  it("3. a stale pin (running CLI newer than the pin) surfaces as a distinct upgrade-available condition, never a silent pass", () => {
    const guidance = [
      `A repo pinned to an older methodology than the running CLI must not silently`,
      `plan the newer content. resolveMethodology (src/methodology.ts) must throw a`,
      `distinct MethodologyUpgradeAvailableError so interactive \`sync\` can offer a`,
      `confirm-to-bump while \`check\`/non-interactive callers still fail loud on it.`,
    ].join("\n");

    // "0.0.1" parses as a valid, strictly-older version under any real release.
    const manifest = parseManifest(manifestYaml("0.0.1"));
    let caught: unknown;
    try {
      planEmit(manifest, process.cwd());
    } catch (err) {
      caught = err;
    }
    expect(caught, guidance).toBeInstanceOf(MethodologyUpgradeAvailableError);
    expect((caught as MethodologyUpgradeAvailableError).pinned, guidance).toBe("0.0.1");
    expect((caught as MethodologyUpgradeAvailableError).running, guidance).toBe(praxisVersion());
  });

  it("4. a pin ahead of the running CLI (running < pinned) hard-fails, always", () => {
    const guidance = [
      `A repo pinned to a methodology newer than the running CLI asks for content`,
      `this install does not have — there is nothing to "offer"; this must always`,
      `be a hard MethodologyIncompatibleError, in sync and in check alike.`,
    ].join("\n");

    // "9999.0.0" parses as a valid version, strictly newer than any real release.
    const manifest = parseManifest(manifestYaml("9999.0.0"));
    expect(() => planEmit(manifest, process.cwd()), guidance).toThrow(MethodologyIncompatibleError);
    expect(() => planEmit(manifest, process.cwd()), guidance).not.toThrow(MethodologyUpgradeAvailableError);
  });
});
