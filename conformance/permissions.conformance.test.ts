import { describe, expect, it } from "vitest";
import { applyOp, planEmit } from "../src/emit.js";
import type { Manifest } from "../src/manifest.js";
import { availablePackages } from "../src/packages.js";
import { loadPolicy, policyCapabilities } from "../src/permissions.js";

/**
 * Conformance: the permission policy is a tool-neutral artifact emitted per-tool
 * (CLAUDE.md "tool-neutral by construction"; docs/wiki/emitters.md, D18/D19). The
 * neutral source carries INTENT (capabilities); emitters translate it, and tools
 * with no permission model emit nothing rather than a fabricated file.
 */

const PKG = "safe-permissions";

const MANIFEST: Manifest = {
  version: 1,
  methodology: "0.1.0",
  targets: ["claude-code", "agents-md"],
  packages: ["karpathy-claude", PKG],
};

describe("conformance: permission policy", () => {
  it("ships a neutral policy whose every capability is translatable (no silent drop)", () => {
    const policy = loadPolicy(availablePackages().get(PKG)!.dir);
    const guidance = [
      `The ${PKG} package must provide a neutral permissions.yaml whose capabilities every emitter`,
      `can translate. If loadPolicy throws, a capability is outside the closed vocabulary — add it`,
      `in src/permissions.ts AND map it in every emitter (CLAUDE_CODE_RULES in src/emit.ts), so no`,
      `capability is silently dropped on emit. See docs/wiki/emitters.md.`,
    ].join("\n");
    expect(policy, guidance).toBeDefined();
    expect(policyCapabilities(policy!).length, guidance).toBeGreaterThan(0);
  });

  it("emits Claude Code permissions to .claude/settings.json as valid, schema-shaped rules", () => {
    const ops = planEmit(MANIFEST).filter((o) => o.kind === "settings" && o.rules);
    const guidance = [
      `Claude Code must receive a settings op carrying rules and writing .claude/settings.json with`,
      `allow/ask/deny arrays of Tool(pattern) rule strings (grammar verified at`,
      `code.claude.com/docs/en/settings). Check PERMISSION_EMITTERS and toClaudeRuleSet() in src/emit.ts.`,
    ].join("\n");
    const claude = ops.find((o) => o.target === "claude-code");
    expect(claude, guidance).toBeDefined();
    expect(claude!.path, guidance).toBe(".claude/settings.json");
    if (claude!.kind !== "settings" || !claude!.rules) throw new Error("expected settings op with rules");
    const all = [...claude!.rules.allow, ...claude!.rules.ask, ...claude!.rules.deny];
    expect(all.length, guidance).toBeGreaterThan(0);
    for (const rule of all) {
      expect(rule, `${guidance}\nMalformed rule: ${rule}`).toMatch(/^[A-Za-z]+\(.+\)$/);
    }
    // deny overrides allow in Claude Code, so secrets stay unreadable despite Read(./**).
    expect(claude!.rules.deny, guidance).toContain("Read(./.env)");
  });

  it("emits nothing for targets with no permission model (no-op, not a fabricated file)", () => {
    const ops = planEmit(MANIFEST).filter((o) => o.kind === "settings" && o.rules);
    const guidance = [
      `A permissions-bearing settings op was emitted for a target with no permission model. Targets`,
      `absent from PERMISSION_EMITTERS (e.g. agents-md, a flat-file standard) must emit NOTHING for`,
      `permissions — never a fabricated settings file (docs/wiki/emitters.md). Check planEmit() in src/emit.ts.`,
    ].join("\n");
    expect(ops.some((o) => o.target === "agents-md"), guidance).toBe(false);
  });

  it("emits no permissions op when no selected package provides a policy", () => {
    const noPolicy: Manifest = { ...MANIFEST, packages: ["karpathy-claude"] };
    const ops = planEmit(noPolicy).filter((o) => o.kind === "settings" && o.rules);
    const guidance = [
      `A permissions-bearing settings op was emitted though no selected package provides a policy.`,
      `The neutral policy is opt-in (its own package); planEmit must emit permissions only when a`,
      `selected package has a permissions.yaml. Check planEmit() in src/emit.ts.`,
    ].join("\n");
    expect(ops.length, guidance).toBe(0);
  });

  it("re-applies as a no-op (emit is idempotent for structured config too)", () => {
    const op = planEmit(MANIFEST).find((o) => o.kind === "settings" && o.rules)!;
    const first = applyOp(op, "");
    const second = applyOp(op, first.text);
    const guidance = [
      `Permission emit is not idempotent: re-applying changed the destination. A second sync with`,
      `the same policy must be a no-op (docs/wiki/merge-engine.md). Check applyOp()/reconcileSettings().`,
    ].join("\n");
    expect(second.changed, guidance).toBe(false);
    expect(second.text, guidance).toBe(first.text);
  });
});
