import { describe, expect, it } from "vitest";
import { applyOp, loadPackageSource, planEmit } from "../src/emit.js";
import type { Manifest } from "../src/manifest.js";
import { findBlock } from "../src/merge.js";
import { availablePackages } from "../src/packages.js";
import { currentMethodology } from "../test/helpers.js";

/**
 * Conformance: Layer 1 emit is tool-neutral and delivered per the target's rules
 * (CLAUDE.md "tool-neutral by construction"; docs/wiki/merge-engine.md,
 * docs/wiki/emitters.md, D13).
 * Neutrality and the Claude Code delivery contract are verified, not assumed.
 */
const MANIFEST: Manifest = {
  version: 1,
  methodology: currentMethodology(),
  stacks: ["python-backend"],
  targets: ["claude-code", "agents-md"],
  packages: ["karpathy-claude"],
};

function opContent(op: ReturnType<typeof planEmit>[number]): string {
  if (op.kind === "owned") return op.content;
  if (op.kind === "block") return op.blocks["karpathy-claude"] ?? "";
  return ""; // permissions ops carry no prose source
}

describe("conformance: Layer 1 emit", () => {
  it("delivers the singular neutral source to every target", () => {
    const source = loadPackageSource(availablePackages().get("karpathy-claude")!.dir);
    const ops = planEmit(MANIFEST);
    const guidance = [
      `A target's emitted output did not contain the singular neutral methodology source.`,
      `The source is one tool-neutral artifact (packages/layer1/karpathy-claude/rules.md); emitters must`,
      `translate it per target, never fork or drop it (CLAUDE.md "tool-neutral by`,
      `construction"). Check renderForTarget()/planEmit() in src/emit.ts.`,
    ].join("\n");
    expect(ops.length, "every declared target must produce at least one op").toBeGreaterThanOrEqual(
      MANIFEST.targets.length,
    );
    for (const op of ops) {
      expect(opContent(op), guidance).toContain(source);
    }
  });

  it("delivers Claude Code methodology as owned .claude/rules files, never by editing CLAUDE.md (D13)", () => {
    const ops = planEmit(MANIFEST).filter((o) => o.target === "claude-code");
    const guidance = [
      `Claude Code methodology must be delivered as owned files under .claude/rules/ —`,
      `Praxis never edits the user's CLAUDE.md (decision D13; verified against Claude Code`,
      `docs: .claude/rules/*.md auto-load every session). Check TARGET_DELIVERY in src/emit.ts.`,
    ].join("\n");
    expect(ops.length, guidance).toBeGreaterThan(0);
    for (const op of ops) {
      expect(op.kind, guidance).toBe("owned");
      expect(op.path.startsWith(".claude/rules/"), guidance).toBe(true);
      expect(op.path, guidance).not.toBe("CLAUDE.md");
    }
  });

  it("delivers owned Claude Code rules as pure prose, with no praxis:begin markers (D13)", () => {
    const ops = planEmit(MANIFEST).filter((o) => o.target === "claude-code" && o.kind === "owned");
    const guidance = [
      `Owned .claude/rules/praxis-*.md files must be whole-file prose with no`,
      `praxis:begin/praxis:end markers — markers exist only for block delivery (e.g.`,
      `AGENTS.md), where Praxis edits inside a managed region of a user-owned file. An`,
      `owned file has no surrounding content to delimit, so a marker there would just be`,
      `pollution Claude has to read past. Check the "owned" branch of planEmit() in src/emit.ts.`,
    ].join("\n");
    expect(ops.length, guidance).toBeGreaterThan(0);
    for (const op of ops) {
      expect(op.kind, guidance).toBe("owned");
      if (op.kind === "owned") {
        expect(op.content, guidance).not.toContain("praxis:begin");
        expect(op.content, guidance).not.toContain("praxis:end");
      }
    }
  });

  it("routes each op to a distinct destination file", () => {
    const paths = planEmit(MANIFEST).map((o) => o.path);
    const guidance = [
      `Two emit ops target the same file — they would clobber each other.`,
      `Each (target, package) must resolve to a distinct destination. Check planEmit().`,
    ].join("\n");
    expect(new Set(paths).size, guidance).toBe(paths.length);
  });

  it("produces stable output that re-applies as a no-op", () => {
    const guidance = [
      `Emit is not idempotent: re-applying an op changed the destination. A second sync`,
      `with the same source must be a no-op (docs/wiki/merge-engine.md). Owned files compare`,
      `equal; block files round-trip through the engine. Check applyOp() in src/emit.ts.`,
    ].join("\n");
    for (const op of planEmit(MANIFEST)) {
      const first = applyOp(op, op.kind === "block" ? "# Project\n" : "");
      if (op.kind === "block") {
        expect(findBlock(first.text, "karpathy-claude"), guidance).toBeDefined();
      }
      const second = applyOp(op, first.text);
      expect(second.changed, guidance).toBe(false);
      expect(second.text, guidance).toBe(first.text);
    }
  });
});
