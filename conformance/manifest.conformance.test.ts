import { describe, expect, it } from "vitest";
import { parseManifest } from "../src/manifest.js";

/**
 * Conformance: praxis.yaml is the declarative truth (docs/wiki/interaction-model.md, D4).
 * For the manifest to be trustworthy, an unrecognized key must be an error — a
 * silently-ignored typo means the repo's stated intent and its actual config
 * diverge, which is the drift the whole tool exists to prevent.
 */

const VALID = `
version: 1
methodology: "0.1.0"
stacks: [python-backend]
targets: [claude-code]
packages: [karpathy-claude]
`;

describe("conformance: manifest contract", () => {
  it("rejects unknown keys instead of silently ignoring them", () => {
    const typo = `${VALID}packagez: [oops]\n`;
    const guidance = [
      `The manifest schema accepted an unrecognized key. praxis.yaml is the declarative`,
      `truth (D4); a silently-ignored typo (e.g. "packagez" for "packages") makes the`,
      `repo's stated intent diverge from its real config. The schema must be strict.`,
      `Check that manifestSchema in src/manifest.ts uses z.strictObject (not a loose object).`,
    ].join("\n");
    let threw = false;
    try {
      parseManifest(typo);
    } catch {
      threw = true;
    }
    expect(threw, guidance).toBe(true);
  });

  it("accepts a minimal valid manifest", () => {
    const guidance = [
      `A minimal, valid praxis.yaml was rejected. The schema must accept the documented`,
      `shape (docs/wiki/interaction-model.md): version, methodology, stacks, targets, packages.`,
      `Check manifestSchema in src/manifest.ts against the interaction-model.md example.`,
    ].join("\n");
    expect(() => parseManifest(VALID), guidance).not.toThrow();
  });
});
