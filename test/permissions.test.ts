import { describe, expect, it } from "vitest";
import { availablePackages } from "../src/packages.js";
import { loadPolicy, parsePolicy, policyCapabilities } from "../src/permissions.js";

/** Look up a shipped package's directory by name — loadPolicy is dir-based. */
function dirOf(pkg: string): string {
  return availablePackages().get(pkg)!.dir;
}

// Behavioral unit tests for the neutral policy loader. The tool-neutrality /
// no-silent-drop invariants live in conformance/permissions.conformance.test.ts.
describe("permission policy loader", () => {
  it("parses a valid policy and defaults missing buckets to empty", () => {
    const policy = parsePolicy("allow:\n  - read-repo\n");
    expect(policy.allow).toEqual(["read-repo"]);
    expect(policy.ask).toEqual([]);
    expect(policy.deny).toEqual([]);
  });

  it("rejects an unknown capability with an actionable message", () => {
    expect(() => parsePolicy("allow:\n  - teleport\n")).toThrow(/Capabilities must be one of/);
  });

  it("rejects unknown top-level keys (strict policy contract)", () => {
    expect(() => parsePolicy("allow: []\nmaybe:\n  - read-repo\n")).toThrow(/permissions\.yaml is invalid/);
  });

  it("loads the shipped safe-permissions policy", () => {
    const policy = loadPolicy(dirOf("safe-permissions"));
    expect(policy).toBeDefined();
    expect(policyCapabilities(policy!)).toContain("read-secrets");
  });

  it("returns undefined for a package with no policy", () => {
    expect(loadPolicy(dirOf("karpathy-claude"))).toBeUndefined();
  });
});
