import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { planEmit } from "../src/emit.js";
import type { Manifest } from "../src/manifest.js";
import { buildProgram, reconcile } from "../src/program.js";
import { currentMethodology } from "../test/helpers.js";

/**
 * Conformance: the workspace tier (D53) — a Praxis hub whose `praxis.yaml`
 * declares a `workspace:` section of independent, cloned member repos, and the
 * `workspace` package (packages/layer2/workspace/) gated on it.
 *
 * Prior art: anchors.conformance.test.ts (the temp-fixture + `reconcile()`
 * pattern, and the D40 unresolvable-manifest scenario mirrored in invariant 6
 * below).
 *
 * Pins:
 *  1. An anchor naming an uncloned member is advisory-only — check still exits 0.
 *  2. A broken anchor inside a *cloned* member fails the check (exit 1).
 *  3. A plain (non-`member:`) anchor is not weakened by the workspace's
 *     presence — it still hard-fails, and never gains skip semantics.
 *  4. `sync`/`check` refuses the `workspace` package when the manifest has no
 *     `workspace:` section, with the actionable "add a `workspace:` section" message.
 *  5. `check` prints the `Workspace: N members — ...` status line.
 *  6. The anchor tripwire still runs when the manifest lists an unknown
 *     package (D40), in a repo that also declares a workspace.
 *  7. The emitted workspace workflow falls back from an unavailable local
 *     CLI to the pinned public npx package in both the hub and members.
 *  8. Both native workflow renderings carry the member-local planning context
 *     needed to inspect implementation details without editing the member.
 *  9. The always-loaded workspace rule triggers that planning workflow in
 *     Claude's native rule file and Codex's AGENTS.md block.
 * 10. The workflow's planning entry scopes the member fan-out to affected
 *     cloned members only, marks steps 2–3 optional and steps 5–6 a planning
 *     synthesis, in both target renderings.
 * 11. The workflow's planning entry runs the entire pass read-only — hub
 *     drift and wiki staleness are proposals only until the user confirms
 *     out of planning — in both target renderings.
 * 12. Both the always-loaded rule and the workflow enumerate a member's
 *     native instruction surfaces (`CLAUDE.md`, `.claude/rules/`, `AGENTS.md`)
 *     instead of the unenumerated "native agent instructions and rules".
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-workspace-conf-"));
  dirs.push(dir);
  return dir;
}

/** A hub manifest declaring two members (member-a, member-b) and the
 *  `workspace` package plus its transitive `requires` (D21). */
const WORKSPACE_MANIFEST_YAML = [
  "version: 1",
  `methodology: "${currentMethodology()}"`,
  "targets: [claude-code]",
  "packages: [wiki-memory, upkeep, session-handoff, workspace]",
  "workspace:",
  "  members:",
  "    - path: member-a",
  "    - path: member-b",
  "  edges: []",
  "",
].join("\n");

/** A fully-synced hub with one cloned member (member-a) and one uncloned
 *  member (member-b), plus a wiki page carrying a `member:` anchor to each
 *  and one plain (non-member) anchor. Fully syncing first isolates the
 *  anchor/workspace-report behavior under test from ordinary managed-file drift. */
function clonedAndUnclonedHub(
  opts: { brokenMemberAnchor?: boolean; brokenPlainAnchor?: boolean } = {},
): string {
  const dir = tempDir();
  writeFileSync(join(dir, "praxis.yaml"), WORKSPACE_MANIFEST_YAML);
  const applied = reconcile(dir, true, "sync");
  if (applied.syncError) throw new Error(`fixture setup failed to sync: ${applied.syncError}`);

  mkdirSync(join(dir, "docs", "wiki"), { recursive: true });
  mkdirSync(join(dir, "member-a", ".git"), { recursive: true });
  writeFileSync(join(dir, "member-a", "README.md"), "# member-a\n");
  // member-b deliberately left uncloned (no directory at all).

  const memberTarget = opts.brokenMemberAnchor ? "NOPE.md" : "README.md";
  const plainTarget = opts.brokenPlainAnchor ? "NOPE.md" : "praxis.yaml";
  writeFileSync(
    join(dir, "docs", "wiki", "page.md"),
    [
      "---",
      "praxisAnchors:",
      "  - type: path",
      `    target: ${memberTarget}`,
      "    member: member-a",
      "  - type: path",
      `    target: ${memberTarget}`,
      "    member: member-b",
      "  - type: path",
      `    target: ${plainTarget}`,
      "---",
      "",
      "# Page",
      "",
    ].join("\n"),
  );

  return dir;
}

describe("conformance: workspace tier", () => {
  it("makes member-local planning an always-loaded rule for Claude Code and Codex", () => {
    const manifest: Manifest = {
      version: 1,
      methodology: currentMethodology(),
      targets: ["claude-code", "codex"],
      packages: ["wiki-memory", "upkeep", "session-handoff", "workspace"],
      workspace: { members: [{ path: "member-a" }], edges: [] },
    };
    const ops = planEmit(manifest);
    const claudeRule = ops.find(
      (op) =>
        op.kind === "owned" &&
        op.target === "claude-code" &&
        op.path === ".claude/rules/praxis-workspace.md",
    );
    const codexRules = ops.find(
      (op) => op.kind === "block" && op.target === "codex" && op.path === "AGENTS.md",
    );
    const renderedRules = [
      claudeRule?.kind === "owned" ? claudeRule.content : undefined,
      codexRules?.kind === "block" ? codexRules.blocks.workspace : undefined,
    ];
    const guidance = [
      `A workspace hub must load the planning fan-out trigger before a workflow is invoked:`,
      `Claude Code through .claude/rules/praxis-workspace.md and Codex through the workspace`,
      `managed block in AGENTS.md. Check packages/layer2/workspace/rules.md.`,
    ].join("\n");

    expect(renderedRules, guidance).not.toContain(undefined);
    for (const content of renderedRules) {
      expect(content, guidance).toMatch(/Planning trigger:[\s\S]*before finalizing the hub plan/);
      expect(content, guidance).toMatch(/one read-only planning workstream per affected cloned\s+member/);
      expect(content, guidance).toContain("resolved member root");
      expect(content, guidance).toContain("first tool action");
      expect(content, guidance).toContain("`docs/wiki/index.md`");
      expect(content, guidance).toMatch(/implementation\s+source and nearest tests/);
      expect(content, guidance).toContain("`file:line`");
    }
    expect(renderedRules[0], guidance).toContain("`/praxis-workspace-upkeep`");
    expect(renderedRules[1], guidance).toContain("`$praxis-workspace-upkeep`");
  });

  it("falls back to @latest when praxis is unavailable in the hub or a member", () => {
    const manifest: Manifest = {
      version: 1,
      methodology: currentMethodology(),
      targets: ["claude-code", "codex"],
      packages: ["wiki-memory", "upkeep", "session-handoff", "workspace"],
      workspace: { members: [{ path: "member-a" }], edges: [] },
    };
    const workflowOps = planEmit(manifest).filter(
      (op) =>
        op.kind === "owned" &&
        (op.path === ".claude/commands/praxis-workspace-upkeep.md" ||
          op.path === ".agents/skills/praxis-workspace-upkeep/SKILL.md"),
    );
    const guidance = [
      `The workspace-upkeep workflow must make CLI resolution executable prose, not merely`,
      `authorize npx in Claude's allowed-tools frontmatter. In both target renderings it`,
      `must say that an unavailable local praxis command falls back to the pinned`,
      `npx @pragmatic-labs/praxis@latest check invocation, and that this applies in the hub`,
      `and every cloned member. Check packages/layer2/workspace/commands/workspace-upkeep.md.`,
    ].join("\n");

    expect(workflowOps, guidance).toHaveLength(2);
    for (const op of workflowOps) {
      if (op.kind !== "owned") continue;
      expect(op.content, guidance).toMatch(/If `praxis` is\s+unavailable/);
      expect(op.content, guidance).toContain("`npx @pragmatic-labs/praxis@latest check`");
      expect(op.content, guidance).toContain("`npx @pragmatic-labs/praxis@latest sync`");
      expect(op.content, guidance).toContain("hub and every cloned member");
    }
  });

  it("carries member-local planning context into both target workflows", () => {
    const manifest: Manifest = {
      version: 1,
      methodology: currentMethodology(),
      targets: ["claude-code", "codex"],
      packages: ["wiki-memory", "upkeep", "session-handoff", "workspace"],
      workspace: { members: [{ path: "member-a" }], edges: [] },
    };
    const workflowOps = planEmit(manifest).filter(
      (op) =>
        op.kind === "owned" &&
        (op.path === ".claude/commands/praxis-workspace-upkeep.md" ||
          op.path === ".agents/skills/praxis-workspace-upkeep/SKILL.md"),
    );
    const guidance = [
      `The workspace-upkeep workflow must make member-local planning executable prose in`,
      `both target renderings: a delegate starts from the resolved member root, loads that`,
      `member's own harness and wiki entrypoint, and checks implementation source plus tests`,
      `with file:line evidence. Check packages/layer2/workspace/commands/workspace-upkeep.md.`,
    ].join("\n");

    expect(workflowOps, guidance).toHaveLength(2);
    for (const op of workflowOps) {
      if (op.kind !== "owned") continue;
      expect(op.content, guidance).toContain("resolved member root");
      expect(op.content, guidance).toContain("first tool action");
      expect(op.content, guidance).toContain("`docs/wiki/index.md`");
      expect(op.content, guidance).toContain("relevant implementation source and nearest tests");
      expect(op.content, guidance).toContain("`file:line`");
      expect(op.content, guidance).toMatch(/do not stop at\s+methodology currency/);
    }
  });

  it("scopes the planning-entry fan-out to affected cloned members and collapses steps 2-3/5-6", () => {
    const manifest: Manifest = {
      version: 1,
      methodology: currentMethodology(),
      targets: ["claude-code", "codex"],
      packages: ["wiki-memory", "upkeep", "session-handoff", "workspace"],
      workspace: { members: [{ path: "member-a" }], edges: [] },
    };
    const workflowOps = planEmit(manifest).filter(
      (op) =>
        op.kind === "owned" &&
        (op.path === ".claude/commands/praxis-workspace-upkeep.md" ||
          op.path === ".agents/skills/praxis-workspace-upkeep/SKILL.md"),
    );
    const guidance = [
      `The workspace-upkeep workflow must give planning a scoped entry, in both target`,
      `renderings: under planning entry, step 4's fan-out narrows to one read-only`,
      `planning workstream per affected cloned member (not the full roster), steps 2-3`,
      `become optional observations, and steps 5-6 collapse into a planning synthesis`,
      `instead of the consolidated upkeep report. Check the "Planning entry" paragraph`,
      `and step 4's opening clause in packages/layer2/workspace/commands/workspace-upkeep.md.`,
    ].join("\n");

    expect(workflowOps, guidance).toHaveLength(2);
    for (const op of workflowOps) {
      if (op.kind !== "owned") continue;
      expect(op.content, guidance).toContain("**Planning entry.**");
      expect(op.content, guidance).toMatch(
        /one read-only planning workstream per affected\s+cloned member/,
      );
      expect(op.content, guidance).toMatch(
        /each\s+\*\*affected\*\* cloned member only, under planning\s+entry/,
      );
      expect(op.content, guidance).toMatch(/treat steps 2 and 3 as optional\s+observations/);
      expect(op.content, guidance).toContain("skipped when they don't bear on the question");
      expect(op.content, guidance).toMatch(
        /collapse\s+steps 5 and 6 into a single planning\s+synthesis/,
      );
      expect(op.content, guidance).toMatch(/instead of the\s+consolidated upkeep report/);
    }
  });

  it("runs the entire planning-entry pass read-only until the user confirms out of planning", () => {
    const manifest: Manifest = {
      version: 1,
      methodology: currentMethodology(),
      targets: ["claude-code", "codex"],
      packages: ["wiki-memory", "upkeep", "session-handoff", "workspace"],
      workspace: { members: [{ path: "member-a" }], edges: [] },
    };
    const workflowOps = planEmit(manifest).filter(
      (op) =>
        op.kind === "owned" &&
        (op.path === ".claude/commands/praxis-workspace-upkeep.md" ||
          op.path === ".agents/skills/praxis-workspace-upkeep/SKILL.md"),
    );
    const guidance = [
      `Claude Code plan mode blocks writes, and step 2 (hub upkeep) and step 3 (wiki`,
      `edits) both want to write. In both target renderings, planning entry must state`,
      `that the entire pass runs read-only — hub drift and wiki staleness reported as`,
      `proposals only, with no sync/wiki/instruction edit applied until the user is out`,
      `of planning and confirms. Check the "Planning entry" paragraph in`,
      `packages/layer2/workspace/commands/workspace-upkeep.md.`,
    ].join("\n");

    expect(workflowOps, guidance).toHaveLength(2);
    for (const op of workflowOps) {
      if (op.kind !== "owned") continue;
      expect(op.content, guidance).toMatch(/entire pass runs read-only in this\s+mode/);
      expect(op.content, guidance).toContain("reported as proposals only");
      expect(op.content, guidance).toContain(
        "no `sync`, wiki edit, or instruction edit is applied",
      );
      expect(op.content, guidance).toMatch(/until the user is\s+out of planning and confirms/);
    }
  });

  it("enumerates a member's native instruction surfaces instead of the unenumerated phrase, in the rule and the workflow", () => {
    const manifest: Manifest = {
      version: 1,
      methodology: currentMethodology(),
      targets: ["claude-code", "codex"],
      packages: ["wiki-memory", "upkeep", "session-handoff", "workspace"],
      workspace: { members: [{ path: "member-a" }], edges: [] },
    };
    const ops = planEmit(manifest);
    const claudeRule = ops.find(
      (op) =>
        op.kind === "owned" &&
        op.target === "claude-code" &&
        op.path === ".claude/rules/praxis-workspace.md",
    );
    const codexRules = ops.find(
      (op) => op.kind === "block" && op.target === "codex" && op.path === "AGENTS.md",
    );
    const workflowOps = ops.filter(
      (op) =>
        op.kind === "owned" &&
        (op.path === ".claude/commands/praxis-workspace-upkeep.md" ||
          op.path === ".agents/skills/praxis-workspace-upkeep/SKILL.md"),
    );
    const renderedContents = [
      claudeRule?.kind === "owned" ? claudeRule.content : undefined,
      codexRules?.kind === "block" ? codexRules.blocks.workspace : undefined,
      ...workflowOps.map((op) => (op.kind === "owned" ? op.content : undefined)),
    ];
    const guidance = [
      `A member's "native agent instructions and rules" is unenumerated — a delegate can`,
      `read CLAUDE.md and miss .claude/rules/ entirely. Both the always-loaded rule and`,
      `the workflow must enumerate the surfaces once, in neutral prose that renders to`,
      `both targets: CLAUDE.md and every file under .claude/rules/ (Claude Code), or`,
      `AGENTS.md (Codex/agents-md). Check packages/layer2/workspace/rules.md and`,
      `packages/layer2/workspace/commands/workspace-upkeep.md.`,
    ].join("\n");

    expect(renderedContents, guidance).toHaveLength(4);
    for (const content of renderedContents) {
      expect(content, guidance).not.toBeUndefined();
      expect(content, guidance).toContain("`CLAUDE.md`");
      expect(content, guidance).toContain("`.claude/rules/`");
      expect(content, guidance).toContain("`AGENTS.md`");
      expect(content, guidance).not.toMatch(/native (agent )?instructions and rules/);
    }
  });

  it("skips an anchor naming an uncloned member — advisory only, check still exits 0", () => {
    const dir = clonedAndUnclonedHub();
    const result = reconcile(dir, false, "check");
    const guidance = [
      `An anchor naming an uncloned workspace member must be an advisory skip, not a`,
      `hard failure — member-b has no directory at all in this fixture. Check`,
      `resolveMemberBase() in src/anchors.ts: a member declared but not cloned (dir`,
      `missing, or missing its .git entry) must return { kind: "skip" }, never a diagnostic.`,
    ].join("\n");
    expect(result.anchorReport?.skipped.some((s) => s.member === "member-b"), guidance).toBe(true);
    expect(result.anchorReport?.ok, guidance).toBe(true);
    expect(result.exitCode, guidance).toBe(0);
  });

  it("fails the check on a broken anchor inside a cloned member", () => {
    const dir = clonedAndUnclonedHub({ brokenMemberAnchor: true });
    const result = reconcile(dir, false, "check");
    const guidance = [
      `A member: anchor pointing at "NOPE.md" inside the CLONED member-a (which has no`,
      `such file) must resolve as a real diagnostic and fail the check. Check the`,
      `member-anchor branch of checkAnchors() in src/anchors.ts: a cloned member (dir +`,
      `.git present) must resolve like a local anchor, not be skipped.`,
    ].join("\n");
    expect(result.anchorReport?.ok, guidance).toBe(false);
    expect(
      result.anchorReport?.diagnostics.some((d) => d.target === "NOPE.md"),
      guidance,
    ).toBe(true);
    expect(result.exitCode, guidance).toBe(1);
  });

  it("does not weaken a plain path anchor — it still hard-fails and never gains skip semantics", () => {
    const dir = clonedAndUnclonedHub({ brokenPlainAnchor: true });
    const result = reconcile(dir, false, "check");
    const guidance = [
      `A plain (no member: field) broken path anchor must still hard-fail exactly as it`,
      `would in a non-workspace repo — the presence of a workspace: section must not`,
      `weaken plain-anchor semantics, and a plain anchor must never appear in the`,
      `skip list (only member: anchors can skip, per resolveMemberBase() in`,
      `src/anchors.ts). Check the anchor.member === undefined branch of checkAnchors().`,
    ].join("\n");
    expect(
      result.anchorReport?.diagnostics.some((d) => d.target === "NOPE.md"),
      guidance,
    ).toBe(true);
    expect(
      result.anchorReport?.skipped.some((s) => s.target === "NOPE.md"),
      guidance,
    ).toBe(false);
    expect(result.exitCode, guidance).toBe(1);
  });

  it("refuses the workspace package when the manifest has no workspace: section (D53)", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "praxis.yaml"),
      [
        "version: 1",
        `methodology: "${currentMethodology()}"`,
        "targets: [claude-code]",
        "packages: [wiki-memory, upkeep, session-handoff, workspace]",
        "",
      ].join("\n"),
    );
    const result = reconcile(dir, false, "check");
    const guidance = [
      `The workspace package targets the derived "workspace" pseudo-stack (D53) and must`,
      `be refused when praxis.yaml has no workspace: section, with an actionable message`,
      `telling the agent to add one (never "add workspace to stacks", which is a dead`,
      `end — see the workspace-specific branch of resolve() in src/packages.ts).`,
    ].join("\n");
    expect(result.syncError, guidance).toBeDefined();
    expect(result.syncError, guidance).toMatch(/add a `workspace:` section/i);
    expect(result.exitCode, guidance).toBe(1);
  });

  it("prints the Workspace: N members status line in check output", async () => {
    const dir = clonedAndUnclonedHub();
    const cwd = process.cwd();
    const exitCode = process.exitCode;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const guidance = [
      `praxis check's console output must contain a "Workspace: N members — ... cloned,`,
      `... not cloned (...); ... Praxis-onboarded." line (greppable — the emitted`,
      `/praxis-workspace-upkeep command reads check output per its step 2). Check`,
      `formatWorkspaceReport() and the console.log call in runReconcile() (src/program.ts).`,
    ].join("\n");
    try {
      process.exitCode = undefined;
      process.chdir(dir);
      await buildProgram().parseAsync(["node", "praxis", "check"], { from: "node" });
      const lines = log.mock.calls.map((c) => String(c[0]));
      expect(
        lines.some((l) => l.includes("Workspace: 2 members — 1 cloned, 1 not cloned (member-b); 0 Praxis-onboarded.")),
        guidance,
      ).toBe(true);
    } finally {
      process.chdir(cwd);
      process.exitCode = exitCode;
      log.mockRestore();
      error.mockRestore();
    }
  });

  it("D40: the anchor tripwire still runs when the manifest lists an unknown package, in a workspace repo", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "praxis.yaml"),
      [
        "version: 1",
        `methodology: "${currentMethodology()}"`,
        "targets: [claude-code]",
        "packages: [this-package-does-not-exist]",
        "workspace:",
        "  members:",
        "    - path: member-a",
        "  edges: []",
        "",
      ].join("\n"),
    );
    mkdirSync(join(dir, "docs", "wiki"), { recursive: true });
    mkdirSync(join(dir, "member-a", ".git"), { recursive: true });
    writeFileSync(join(dir, "member-a", "README.md"), "# member-a\n");
    writeFileSync(
      join(dir, "docs", "wiki", "page.md"),
      [
        "---",
        "praxisAnchors:",
        "  - type: path",
        "    target: README.md",
        "    member: member-a",
        "---",
        "",
        "# Page",
        "",
      ].join("\n"),
    );

    const result = reconcile(dir, false, "check");
    const guidance = [
      `praxis check skipped the knowledge-anchor tripwire because the manifest failed to`,
      `resolve (${result.syncError ?? "no sync error captured"}), even though a workspace:`,
      `section is declared. Per D40, the anchor check (and D53's member-anchor`,
      `resolution) must run independently of runSync's try/catch — an unresolvable`,
      `package must never leave a workspace repo's member anchors dark. Check reconcile()`,
      `in src/program.ts.`,
    ].join("\n");
    expect(result.syncError, guidance).toBeDefined();
    expect(result.anchorReport, guidance).toBeDefined();
    expect(result.anchorReport?.anchorsChecked, guidance).toBe(1);
    expect(result.anchorReport?.ok, guidance).toBe(true);
    expect(result.exitCode, guidance).toBe(1);
  });
});
