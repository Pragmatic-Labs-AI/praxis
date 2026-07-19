import { describe, expect, it } from "vitest";
import { applyOp, loadCommandSources, planEmit } from "../src/emit.js";
import type { Manifest } from "../src/manifest.js";
import { availablePackages } from "../src/packages.js";

/**
 * Conformance: slash commands are a tool-neutral artifact (third `provides`
 * kind, docs/wiki/packages-and-emit.md/docs/wiki/emitters.md) emitted per-tool. Targets with no command model
 * emit nothing — never a fabricated file.
 *
 * Data-driven: the invariants below hold for EVERY package that declares
 * `provides: [commands]`, so a new command package is covered the moment it
 * ships its package.yaml — no test edit required (D24).
 */

const COMMAND_PACKAGES = [...availablePackages().values()]
  .filter((p) => p.provides.includes("commands"))
  .map((p) => p.name)
  .sort();

/** Look up a shipped package's directory by name — loadCommandSources is dir-based. */
function dirOf(pkg: string): string {
  return availablePackages().get(pkg)!.dir;
}

// Gate-aware: a package targeting a stack (Layer 2, incl. the derived
// "workspace" pseudo-stack, D53) needs a manifest that satisfies its gate, or
// resolvePackages() throws before planEmit ever runs. "workspace" needs a
// `workspace:` section (with >=1 member) instead of an entry in `stacks`,
// since it's derived rather than user-declarable (src/packages.ts). Also pull
// in the package's own `requires` (D21) — the workspace package requires
// wiki-memory/upkeep/session-handoff, none of which declare their own stack.
const manifestWith = (pkg: string): Manifest => {
  const resolved = availablePackages().get(pkg);
  const base: Manifest = {
    version: 1,
    methodology: "0.1.0",
    targets: ["claude-code", "agents-md"],
    packages: ["karpathy-claude", pkg, ...(resolved?.requires ?? [])],
  };
  if (resolved?.stack === "workspace") {
    return { ...base, workspace: { members: [{ path: "member-a" }], edges: [] } };
  }
  if (resolved?.stack) {
    return { ...base, stacks: [resolved.stack] };
  }
  return base;
};

describe("conformance: slash commands", () => {
  it("has at least one package providing commands", () => {
    const guidance = [
      `No package declares 'provides: [commands]'. A commands package ships`,
      `commands/*.md plus a package.yaml with "commands" in provides.`,
      `Prior art: packages/layer1/instruction-upkeep/.`,
    ].join("\n");
    expect(COMMAND_PACKAGES.length, guidance).toBeGreaterThan(0);
  });

  it.each(COMMAND_PACKAGES)("%s ships at least one command file", (pkg) => {
    const guidance = [
      `The ${pkg} package declares it provides commands but ships no commands/*.md file.`,
      `Check loadCommandSources() in src/emit.ts and packages/layer1/${pkg}/commands/.`,
    ].join("\n");
    expect(loadCommandSources(dirOf(pkg)).length, guidance).toBeGreaterThan(0);
  });

  it.each(COMMAND_PACKAGES)(
    "%s delivers Claude Code commands as owned .claude/commands/praxis-*.md files",
    (pkg) => {
      const ops = planEmit(manifestWith(pkg)).filter(
        (o) => o.target === "claude-code" && o.kind === "owned" && o.path.startsWith(".claude/commands/"),
      );
      const guidance = [
        `Claude Code slash commands must be delivered as owned files under .claude/commands/,`,
        `prefixed praxis- so they're identifiable as managed (mirrors .claude/rules/praxis-*.md).`,
        `Check COMMAND_DIR and the commands branch of planEmit() in src/emit.ts.`,
      ].join("\n");
      expect(ops.length, guidance).toBeGreaterThan(0);
      for (const op of ops) {
        expect(op.kind, guidance).toBe("owned");
        expect(op.path, guidance).toMatch(/^\.claude\/commands\/praxis-.+\.md$/);
      }
    },
  );

  it.each(COMMAND_PACKAGES)("%s delivers valid Codex repo skills", (pkg) => {
    const codexManifest: Manifest = { ...manifestWith(pkg), targets: ["codex"] };
    const ops = planEmit(codexManifest).filter(
      (op) => op.kind === "owned" && op.path.startsWith(".agents/skills/praxis-"),
    );
    expect(ops.length, `${pkg} must emit at least one Codex SKILL.md`).toBeGreaterThan(0);
    for (const op of ops) {
      if (op.kind !== "owned") continue;
      expect(op.path).toMatch(/^\.agents\/skills\/praxis-[^/]+\/SKILL\.md$/);
      expect(op.content).toMatch(/^---\nname: praxis-[^\n]+\ndescription: [^\n]+\n---\n/);
      expect(op.content).not.toMatch(/^(allowed-tools|argument-hint):/m);
      expect(op.content).not.toContain("{{");
    }
  });

  it.each(COMMAND_PACKAGES)(
    "%s emits nothing for targets with no command model (no-op, not a fabricated file)",
    (pkg) => {
      const ops = planEmit(manifestWith(pkg)).filter((o) => o.path.startsWith(".claude/commands/"));
      const guidance = [
        `A command op was emitted for a target with no command model. Targets absent from`,
        `COMMAND_DIR (e.g. agents-md, a flat-file standard) must emit NOTHING for commands —`,
        `never a fabricated file (mirrors the permission emitter's no-op rule, docs/wiki/emitters.md).`,
        `Check planEmit() in src/emit.ts.`,
      ].join("\n");
      expect(ops.some((o) => o.target === "agents-md"), guidance).toBe(false);
    },
  );

  it.each(COMMAND_PACKAGES)("%s re-applies as a no-op (emit is idempotent)", (pkg) => {
    const ops = planEmit(manifestWith(pkg)).filter((o) => o.path.startsWith(".claude/commands/"));
    const guidance = [
      `Command emit is not idempotent: re-applying an op changed the destination. A second sync`,
      `with the same source must be a no-op (docs/wiki/merge-engine.md). Check applyOp() in src/emit.ts.`,
    ].join("\n");
    for (const op of ops) {
      const first = applyOp(op, "");
      const second = applyOp(op, first.text);
      expect(second.changed, guidance).toBe(false);
      expect(second.text, guidance).toBe(first.text);
    }
  });

  it("emits no command ops when no selected package provides commands", () => {
    const noCommands: Manifest = { ...manifestWith("karpathy-claude"), packages: ["karpathy-claude"] };
    const ops = planEmit(noCommands).filter((o) => o.path.startsWith(".claude/commands/"));
    const guidance = [
      `A command op was emitted though no selected package provides commands. Commands are`,
      `opt-in (their own package); planEmit must emit them only when a selected package's`,
      `'provides' includes "commands". Check planEmit() in src/emit.ts.`,
    ].join("\n");
    expect(ops.length, guidance).toBe(0);
  });

  it("instruction-upkeep emits its rule and the /praxis-instructions command", () => {
    const ops = planEmit(manifestWith("instruction-upkeep")).filter((o) => o.target === "claude-code");
    const guidance = [
      `The instruction-upkeep package must emit its owned rule (.claude/rules/praxis-instruction-upkeep.md)`,
      `and the /praxis-instructions command (.claude/commands/praxis-instructions.md). Check that`,
      `packages/layer1/instruction-upkeep/{rules.md,commands/instructions.md} exist and package.yaml`,
      `declares provides: [rules, commands].`,
    ].join("\n");
    expect(ops.some((o) => o.path === ".claude/rules/praxis-instruction-upkeep.md"), guidance).toBe(true);
    expect(ops.some((o) => o.path === ".claude/commands/praxis-instructions.md"), guidance).toBe(true);
  });

  it("session-handoff emits the /praxis-handoff command", () => {
    const ops = planEmit(manifestWith("session-handoff")).filter(
      (o) => o.target === "claude-code" && o.path === ".claude/commands/praxis-handoff.md",
    );
    const guidance = [
      `The session-handoff package must emit .claude/commands/praxis-handoff.md.`,
      `Check packages/layer1/session-handoff/commands/handoff.md exists.`,
    ].join("\n");
    expect(ops.length, guidance).toBe(1);
  });

  it("wiki-memory emits its rule and the /praxis-wiki command", () => {
    const ops = planEmit(manifestWith("wiki-memory")).filter((o) => o.target === "claude-code");
    const guidance = [
      `The wiki-memory package must emit its owned rule (.claude/rules/praxis-wiki-memory.md)`,
      `and the /praxis-wiki command (.claude/commands/praxis-wiki.md). Check that`,
      `packages/layer1/wiki-memory/{rules.md,commands/wiki.md} exist and package.yaml`,
      `declares provides: [rules, commands].`,
    ].join("\n");
    expect(ops.some((o) => o.path === ".claude/rules/praxis-wiki-memory.md"), guidance).toBe(true);
    expect(ops.some((o) => o.path === ".claude/commands/praxis-wiki.md"), guidance).toBe(true);
  });

  it("capture-codebase-patterns emits the /praxis-capture-codebase-patterns command", () => {
    const ops = planEmit(manifestWith("capture-codebase-patterns")).filter(
      (o) => o.target === "claude-code" && o.path === ".claude/commands/praxis-capture-codebase-patterns.md",
    );
    const guidance = [
      `The capture-codebase-patterns package must emit .claude/commands/praxis-capture-codebase-patterns.md.`,
      `Check packages/layer1/capture-codebase-patterns/commands/capture-codebase-patterns.md exists.`,
    ].join("\n");
    expect(ops.length, guidance).toBe(1);
  });

  it("upkeep emits its rule and the /praxis-upkeep command", () => {
    const ops = planEmit(manifestWith("upkeep")).filter((o) => o.target === "claude-code");
    const guidance = [
      `The upkeep package must emit its owned rule (.claude/rules/praxis-upkeep.md)`,
      `and the /praxis-upkeep command (.claude/commands/praxis-upkeep.md). Check that`,
      `packages/layer1/upkeep/{rules.md,commands/upkeep.md} exist and package.yaml`,
      `declares provides: [rules, commands].`,
    ].join("\n");
    expect(ops.some((o) => o.path === ".claude/rules/praxis-upkeep.md"), guidance).toBe(true);
    expect(ops.some((o) => o.path === ".claude/commands/praxis-upkeep.md"), guidance).toBe(true);
  });
});

/**
 * Conformance: onboarding bootstrap-delegation composition (D36).
 * The <!-- praxis:bootstrap-delegations --> marker in onboard.md is replaced
 * at planEmit time with a bullet list of every selected package that declares
 * an `onboarding` hook — data-driven, not hardcoded.
 *
 * Invariants:
 * 1. WITH wiki-memory selected → emitted praxis-onboard.md contains the /praxis-wiki delegation.
 * 2. WITHOUT wiki-memory selected → emitted praxis-onboard.md contains NO delegation bullet.
 * 3. The marker itself NEVER survives into emitted output (any manifest).
 */
describe("conformance: onboarding bootstrap-delegation composition (D36)", () => {
  const onboardManifestWith = (extraPkg: string | null): Manifest => ({
    version: 1,
    methodology: "0.1.0",
    targets: ["claude-code"],
    packages: extraPkg ? ["karpathy-claude", "onboarding", extraPkg] : ["karpathy-claude", "onboarding"],
  });

  function onboardOp(manifest: Manifest) {
    return planEmit(manifest).find(
      (o) => o.target === "claude-code" && o.kind === "owned" && o.path === ".claude/commands/praxis-onboard.md",
    );
  }

  it("emits the /praxis-wiki delegation when wiki-memory is selected", () => {
    const guidance = [
      `The emitted .claude/commands/praxis-onboard.md does not contain the /praxis-wiki delegation`,
      `even though wiki-memory is selected. planEmit must replace the`,
      `<!-- praxis:bootstrap-delegations --> marker with a bullet per package declaring 'onboarding'.`,
      `Check the marker-splice branch in planEmit() (src/emit.ts) and the 'onboarding' field in`,
      `packages/layer1/wiki-memory/package.yaml.`,
    ].join("\n");
    const op = onboardOp(onboardManifestWith("wiki-memory"));
    expect(op, guidance).toBeDefined();
    expect(op?.kind === "owned" && op.content.includes("`/praxis-wiki`"), guidance).toBe(true);
  });

  it("emits NO delegation bullet when no selected package declares an onboarding hook", () => {
    const guidance = [
      `The emitted .claude/commands/praxis-onboard.md contains a delegation bullet even though`,
      `no selected package declares an 'onboarding' hook. The marker must be replaced with`,
      `nothing (empty string) when there are no declared hooks — surrounding prose must still`,
      `read. Check the onboardingDelegations computation in planEmit() (src/emit.ts).`,
    ].join("\n");
    const op = onboardOp(onboardManifestWith(null));
    expect(op, guidance).toBeDefined();
    // No "- `/praxis-" delegation bullet should appear
    expect(op?.kind === "owned" && op.content.includes("- `/praxis-"), guidance).toBe(false);
  });

  it("the <!-- praxis:bootstrap-delegations --> marker never survives into emitted output", () => {
    const guidance = [
      `The <!-- praxis:bootstrap-delegations --> marker survived into emitted output.`,
      `planEmit must always replace the marker — whether with delegations or with an empty`,
      `string. A visible HTML comment in a shipped command file is a bug.`,
      `Check the marker-splice branch in planEmit() (src/emit.ts).`,
    ].join("\n");
    // Test both: with and without wiki-memory
    for (const manifest of [onboardManifestWith("wiki-memory"), onboardManifestWith(null)]) {
      const op = onboardOp(manifest);
      expect(
        op?.kind === "owned" && op.content.includes("<!-- praxis:bootstrap-delegations -->"),
        guidance,
      ).toBe(false);
    }
  });
});
