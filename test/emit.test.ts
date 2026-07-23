import { describe, expect, it } from "vitest";
import { applyOp, computeMethodologySize, loadPackageSource, planEmit } from "../src/emit.js";
import type { Manifest } from "../src/manifest.js";
import { findBlock } from "../src/merge.js";
import { availablePackages } from "../src/packages.js";
import { currentMethodology } from "./helpers.js";

/** Look up a shipped package's directory by name, for loader calls that are
 *  now dir-based (project-local packages, see src/packages.ts `dir`). */
function dirOf(pkg: string): string {
  return availablePackages().get(pkg)!.dir;
}

const manifest: Manifest = {
  version: 1,
  methodology: currentMethodology(),
  stacks: ["python-backend"],
  targets: ["claude-code", "agents-md"],
  packages: ["karpathy-claude"],
};

describe("emit", () => {
  it("loads the karpathy-claude neutral source", () => {
    expect(loadPackageSource(dirOf("karpathy-claude"))).toMatch(/simplicity first/i);
  });

  it("returns undefined for a package that provides no rules", () => {
    // safe-permissions provides `permissions`, not prose rules.
    expect(loadPackageSource(dirOf("safe-permissions"))).toBeUndefined();
  });

  it("delivers claude-code as an owned .claude/rules file (only content packages)", () => {
    const ops = planEmit(manifest).filter((o) => o.target === "claude-code");
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    expect(op.kind).toBe("owned");
    expect(op.path).toBe(".claude/rules/praxis-karpathy-claude.md");
  });

  it("delivers agents-md as a managed block in AGENTS.md", () => {
    const op = planEmit(manifest).find((o) => o.target === "agents-md");
    expect(op?.kind).toBe("block");
    expect(op?.path).toBe("AGENTS.md");
    expect(op?.kind === "block" && Object.keys(op.blocks)).toEqual(["karpathy-claude"]);
  });

  it("coalesces Codex and agents-md into one AGENTS.md operation", () => {
    const allTargets: Manifest = {
      ...manifest,
      targets: ["claude-code", "codex", "agents-md"],
      packages: ["karpathy-claude", "instruction-upkeep"],
    };
    const ops = planEmit(allTargets);
    expect(ops.filter((op) => op.path === "AGENTS.md")).toHaveLength(1);
    expect(new Set(ops.map((op) => op.path)).size).toBe(ops.length);
  });

  it("turns Layer 2 path frontmatter into Codex-readable applicability prose", () => {
    const codexNode: Manifest = {
      version: 1,
      methodology: currentMethodology(),
      stacks: ["node"],
      targets: ["codex"],
      packages: ["karpathy-claude", "node-recipes"],
    };
    const op = planEmit(codexNode).find((candidate) => candidate.kind === "block")!;
    expect(op.kind === "block" && op.blocks["node-recipes"]).toMatch(/^Applies only when working/);
    expect(op.kind === "block" && op.blocks["node-recipes"]).not.toMatch(/^---/);
  });

  it("emits Codex commands as valid repo skills while preserving Claude command metadata", () => {
    const both: Manifest = {
      ...manifest,
      targets: ["claude-code", "codex"],
      packages: ["karpathy-claude", "instruction-upkeep"],
    };
    const ops = planEmit(both);
    const skill = ops.find((op) => op.path === ".agents/skills/praxis-instructions/SKILL.md");
    expect(skill?.kind).toBe("owned");
    if (skill?.kind !== "owned") throw new Error("expected Codex skill");
    expect(skill.content).toMatch(/^---\nname: praxis-instructions\ndescription: /);
    expect(skill.content).not.toContain("allowed-tools:");
    expect(skill.content).not.toContain("argument-hint:");
    expect(skill.content).not.toContain("/praxis-");
    const claude = ops.find((op) => op.path === ".claude/commands/praxis-instructions.md");
    expect(claude?.kind === "owned" && claude.content).toContain("description:");
    expect(claude?.kind === "owned" && claude.content).not.toContain("{{arguments}}");
  });

  it("emits Ponytail but not Draw.io to the Codex marketplace", () => {
    const plugins: Manifest = {
      ...manifest,
      targets: ["codex"],
      packages: ["karpathy-claude", "ponytail", "drawio"],
    };
    const op = planEmit(plugins).find((candidate) => candidate.kind === "codex-marketplace");
    expect(op?.kind).toBe("codex-marketplace");
    if (op?.kind !== "codex-marketplace") throw new Error("expected Codex marketplace");
    expect(op.plugins.map((plugin) => plugin.name)).toEqual(["ponytail"]);
    expect(op.plugins[0]?.source.ref).toMatch(/^[0-9a-f]{40}$/);
  });

  it("applies an owned op by placing the file wholesale", () => {
    const op = planEmit(manifest).find((o) => o.kind === "owned")!;
    const res = applyOp(op, "");
    expect(res.changed).toBe(true);
    expect(res.text).toBe(op.kind === "owned" ? op.content : "");
    expect(applyOp(op, res.text).changed).toBe(false);
  });

  it("applies a block op via the engine, preserving existing text", () => {
    const op = planEmit(manifest).find((o) => o.kind === "block")!;
    const res = applyOp(op, "# Existing\n");
    expect(res.text.startsWith("# Existing\n")).toBe(true);
    expect(findBlock(res.text, "karpathy-claude")).toBeDefined();
  });

  describe("computeMethodologySize", () => {
    it("counts the claude-code owned rule file when claude-code is a target", () => {
      const source = loadPackageSource(dirOf("karpathy-claude"))!;
      const size = computeMethodologySize(manifest);
      expect(size).toEqual({ totalLines: source.split("\n").length, fileCount: 1 });
    });

    it("falls back to the agents-md block when claude-code isn't a target", () => {
      const agentsOnly: Manifest = { ...manifest, targets: ["agents-md"] };
      const source = loadPackageSource(dirOf("karpathy-claude"))!;
      const size = computeMethodologySize(agentsOnly);
      expect(size).toEqual({ totalLines: source.split("\n").length, fileCount: 1 });
    });

    it("counts one file per rules package, never double-counting claude-code vs agents-md", () => {
      const twoPackages: Manifest = { ...manifest, packages: ["karpathy-claude", "onboarding"] };
      const size = computeMethodologySize(twoPackages);
      expect(size.fileCount).toBe(2);
      const expectedTotal =
        loadPackageSource(dirOf("karpathy-claude"))!.split("\n").length +
        loadPackageSource(dirOf("onboarding"))!.split("\n").length;
      expect(size.totalLines).toBe(expectedTotal);
    });

    it("returns zero when the manifest selects no rules packages", () => {
      const noRules: Manifest = { ...manifest, packages: ["safe-permissions"] };
      expect(computeMethodologySize(noRules)).toEqual({ totalLines: 0, fileCount: 0 });
    });

    it("propagates planEmit's resolution error for an unknown package (caller's job to catch)", () => {
      const bad: Manifest = { ...manifest, packages: ["this-package-does-not-exist"] };
      expect(() => computeMethodologySize(bad)).toThrow();
    });
  });
});
