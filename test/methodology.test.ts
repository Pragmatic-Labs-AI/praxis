import { describe, expect, it } from "vitest";
import {
  MethodologyIncompatibleError,
  MethodologyLineNotFoundError,
  MethodologyUpgradeAvailableError,
  resolveMethodology,
  setMethodologyInYaml,
} from "../src/methodology.js";

/**
 * Unit tests for the pure methodology-version resolver (A1). No filesystem, no
 * CLI plumbing — just `resolveMethodology(pinned, running)` against the table
 * in the design's decision (d): equal is a no-op; pinned older (and valid)
 * throws the distinct upgrade-available condition; pinned newer, or
 * unparseable, always hard-fails.
 */

describe("resolveMethodology", () => {
  it("does nothing when pinned equals running", () => {
    expect(() => resolveMethodology("0.1.18", "0.1.18")).not.toThrow();
  });

  it("throws MethodologyUpgradeAvailableError when running is newer than a valid pinned version", () => {
    expect(() => resolveMethodology("0.1.0", "0.1.18")).toThrow(MethodologyUpgradeAvailableError);
  });

  it("MethodologyUpgradeAvailableError carries both versions for the caller to render", () => {
    try {
      resolveMethodology("0.1.0", "0.1.18");
      expect.fail("expected resolveMethodology to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MethodologyUpgradeAvailableError);
      const upgrade = err as MethodologyUpgradeAvailableError;
      expect(upgrade.pinned).toBe("0.1.0");
      expect(upgrade.running).toBe("0.1.18");
      expect(upgrade.message).toMatch(/0\.1\.0/);
      expect(upgrade.message).toMatch(/0\.1\.18/);
    }
  });

  it("throws MethodologyIncompatibleError when pinned is newer than running", () => {
    expect(() => resolveMethodology("2.0.0", "0.1.18")).toThrow(MethodologyIncompatibleError);
  });

  it("throws MethodologyIncompatibleError for an unparseable pinned version", () => {
    expect(() => resolveMethodology("not-a-real-version", "0.1.18")).toThrow(MethodologyIncompatibleError);
  });

  it("names the pinned string and the running version in the incompatible-version message", () => {
    expect(() => resolveMethodology("not-a-real-version", "0.1.18")).toThrow(/not-a-real-version/);
    expect(() => resolveMethodology("not-a-real-version", "0.1.18")).toThrow(/0\.1\.18/);
  });

  it("compares numerically across minor/patch widths (e.g. 0.2.0 > 0.1.9)", () => {
    // Regression pin: a naive string compare would rank "0.1.9" > "0.2.0".
    expect(() => resolveMethodology("0.2.0", "0.1.9")).toThrow(MethodologyIncompatibleError);
    expect(() => resolveMethodology("0.1.9", "0.2.0")).toThrow(MethodologyUpgradeAvailableError);
  });

  it("treats an empty string as unparseable, not a wildcard", () => {
    expect(() => resolveMethodology("", "0.1.18")).toThrow(MethodologyIncompatibleError);
  });
});

describe("setMethodologyInYaml", () => {
  const guidance =
    "setMethodologyInYaml (src/methodology.ts) must rewrite only the methodology: " +
    "value — a line-targeted text edit, never a renderManifestYaml re-render that would " +
    "destroy a hand-edited praxis.yaml's comments/formatting (D59/D62 confirm-to-bump).";

  it("rewrites a double-quoted value, byte-preserving every other line", () => {
    const before = [
      "# praxis.yaml — the methodology installed in this repo (the declarative truth).",
      "# Edit this, then run `praxis sync`. `praxis check` reports drift.",
      "version: 1",
      'methodology: "0.1.0"',
      "targets: [agents-md]",
      "packages: [karpathy-claude]",
      "",
    ].join("\n");
    const after = setMethodologyInYaml(before, "0.1.18");
    expect(after, guidance).toBe(before.replace('"0.1.0"', '"0.1.18"'));
    expect(after, guidance).toContain('methodology: "0.1.18"');
    // Every other line is untouched.
    const beforeLines = before.split("\n");
    const afterLines = after.split("\n");
    expect(afterLines.length, guidance).toBe(beforeLines.length);
    for (let i = 0; i < beforeLines.length; i++) {
      if (i === 3) continue; // the rewritten methodology: line itself
      expect(afterLines[i], guidance).toBe(beforeLines[i]);
    }
  });

  it("rewrites an unquoted value, keeping it unquoted", () => {
    const before = "version: 1\nmethodology: 0.1.0\ntargets: [agents-md]\npackages: [karpathy-claude]\n";
    const after = setMethodologyInYaml(before, "0.1.18");
    expect(after, guidance).toBe("version: 1\nmethodology: 0.1.18\ntargets: [agents-md]\npackages: [karpathy-claude]\n");
  });

  it("preserves a trailing inline comment on the methodology line", () => {
    const before =
      "version: 1\n" +
      'methodology: "0.1.0"  # pinned — bump only via `praxis sync`\n' +
      "targets: [agents-md]\n" +
      "packages: [karpathy-claude]\n";
    const after = setMethodologyInYaml(before, "0.1.18");
    expect(after, guidance).toBe(
      "version: 1\n" +
        'methodology: "0.1.18"  # pinned — bump only via `praxis sync`\n' +
        "targets: [agents-md]\n" +
        "packages: [karpathy-claude]\n",
    );
  });

  it("byte-preserves a full block-style manifest with hand-written comments, changing only the version", () => {
    const before = [
      "# our team's praxis.yaml — DO NOT reformat this file, Bob spent an hour on it",
      "version: 1",
      'methodology: "0.1.0" # keep in sync with CI image',
      "",
      "# stacks we actually use (react is legacy, kill it eventually)",
      "stacks:",
      "  - node",
      "  - react",
      "",
      "targets: [claude-code, agents-md]",
      "",
      "# packages, one per line so diffs are readable in review",
      "packages:",
      "  - karpathy-claude",
      "  - node-recipes",
      "",
    ].join("\n");
    const after = setMethodologyInYaml(before, "0.1.18");

    const beforeLines = before.split("\n");
    const afterLines = after.split("\n");
    expect(afterLines.length, guidance).toBe(beforeLines.length);
    for (let i = 0; i < beforeLines.length; i++) {
      if (i === 2) continue; // the rewritten methodology: line itself
      expect(afterLines[i], guidance).toBe(beforeLines[i]);
    }
    expect(afterLines[2], guidance).toBe('methodology: "0.1.18" # keep in sync with CI image');
  });

  it("throws MethodologyLineNotFoundError when there is no methodology: line", () => {
    expect(() => setMethodologyInYaml("version: 1\ntargets: [agents-md]\n", "0.1.18")).toThrow(
      MethodologyLineNotFoundError,
    );
  });
});
