import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyInit,
  defaultManifest,
  detectContext,
  manifestFromSelections,
  needsSetupSentinel,
  previewInit,
  renderManifestYaml,
} from "../src/init.js";
import { parseManifest, type Manifest, type Workspace } from "../src/manifest.js";
import { SHARED_PROJECT_BEGIN, SHARED_PROJECT_END } from "../src/shared-instructions.js";
import { runSync } from "../src/sync.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-init-"));
  dirs.push(dir);
  return dir;
}

describe("init", () => {
  it("detects project context", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "pyproject.toml"), "[project]\n", "utf8");
    writeFileSync(join(dir, "AGENTS.md"), "# notes\n", "utf8");
    const ctx = detectContext(dir);
    expect(ctx.hasAgentsMd).toBe(true);
    expect(ctx.hasClaudeMd).toBe(false);
    expect(ctx.detectedStacks).toEqual(["python-backend"]);
    expect(ctx.manifestExists).toBe(false);
  });

  it("detects node stack when package.json exists (no react)", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app" }), "utf8");
    const ctx = detectContext(dir);
    expect(ctx.detectedStacks).toEqual(["node"]);
  });

  it("detects both node and react when package.json has react in dependencies", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^18.0.0" } }),
      "utf8",
    );
    const ctx = detectContext(dir);
    expect(ctx.detectedStacks).toContain("node");
    expect(ctx.detectedStacks).toContain("react");
    expect(ctx.detectedStacks).toEqual(["node", "react"]);
  });

  it("detects react via devDependencies", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "my-app", devDependencies: { react: "^18.0.0" } }),
      "utf8",
    );
    const ctx = detectContext(dir);
    expect(ctx.detectedStacks).toContain("react");
  });

  it("detects python-backend from requirements.txt", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "requirements.txt"), "flask\n", "utf8");
    const ctx = detectContext(dir);
    expect(ctx.detectedStacks).toEqual(["python-backend"]);
  });

  it("detects python-backend from setup.py", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "setup.py"), "from setuptools import setup\n", "utf8");
    const ctx = detectContext(dir);
    expect(ctx.detectedStacks).toEqual(["python-backend"]);
  });

  it("returns empty detectedStacks for a bare repo", () => {
    const dir = tempDir();
    const ctx = detectContext(dir);
    expect(ctx.detectedStacks).toEqual([]);
  });

  it("detectedMembers finds nested git repos, sorted, ignoring non-repos and dot-dirs", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "zeta", ".git"), { recursive: true }); // dir with a .git dir
    // worktree-style member: ".git" is a file, not a dir
    mkdirSync(join(dir, "alpha"), { recursive: true });
    writeFileSync(join(dir, "alpha", ".git"), "gitdir: ../.git/worktrees/alpha\n", "utf8");
    mkdirSync(join(dir, "docs"), { recursive: true }); // no .git — not a member
    mkdirSync(join(dir, ".hidden", ".git"), { recursive: true }); // dot-dir — excluded even with .git
    const ctx = detectContext(dir);
    expect(ctx.detectedMembers).toEqual(["alpha", "zeta"]);
  });

  it("detectedMembers is empty for a repo with no nested repos", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "docs"), { recursive: true });
    expect(detectContext(dir).detectedMembers).toEqual([]);
  });

  it("detectedMembers does not crash on an unreadable/missing directory", () => {
    const dir = tempDir();
    const missing = join(dir, "does-not-exist");
    expect(() => detectContext(missing)).not.toThrow();
    expect(detectContext(missing).detectedMembers).toEqual([]);
  });

  it("detects Claude, Codex, and generic targets from project artifacts", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "CLAUDE.md"), "# Claude\n", "utf8");
    writeFileSync(join(dir, "AGENTS.md"), "# Agents\n", "utf8");
    writeFileSync(join(dir, ".codex"), "marker", "utf8");
    expect(detectContext(dir, "").detectedTargets).toEqual(["claude-code", "codex", "agents-md"]);
  });

  it("detects installed CLIs and falls back to legacy defaults when nothing is detected", () => {
    const dir = tempDir();
    const bin = tempDir();
    writeFileSync(join(bin, "codex"), "", "utf8");
    expect(detectContext(dir, bin).detectedTargets).toEqual(["codex"]);
    expect(defaultManifest(detectContext(dir, "")).targets).toEqual(["claude-code", "agents-md"]);
  });

  it("keeps the default manifest's targets machine-independent: a PATH-installed CLI with no repo artifacts is an interactive suggestion, not a non-interactive default", () => {
    const dir = tempDir();
    const bin = tempDir();
    writeFileSync(join(bin, "codex"), "", "utf8");
    const ctx = detectContext(dir, bin);
    expect(ctx.detectedTargets).toEqual(["codex"]);
    expect(ctx.detectedTargetsFromArtifacts).toEqual([]);
    // Two machines cloning the same fresh repo — one with `codex` on PATH, one
    // without — must get the same `praxis init --yes` manifest.
    expect(defaultManifest(ctx).targets).toEqual(["claude-code", "agents-md"]);
    expect(defaultManifest(detectContext(dir, "")).targets).toEqual(["claude-code", "agents-md"]);
  });

  it("does not crash on malformed package.json", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), "not json {{{", "utf8");
    const ctx = detectContext(dir);
    // node is detected (package.json exists), react is not (parse failed)
    expect(ctx.detectedStacks).toEqual(["node"]);
  });

  it("renders a default manifest the loader accepts", () => {
    const manifest = defaultManifest(detectContext(tempDir()));
    expect(parseManifest(renderManifestYaml(manifest))).toEqual(manifest);
  });

  it("renders a manifest without a workspace section byte-identically (regression pin)", () => {
    const manifest: Manifest = {
      version: 1,
      methodology: "0.1.0",
      stacks: ["node"],
      targets: ["claude-code", "agents-md"],
      packages: ["karpathy-claude", "node-recipes"],
    };
    const expected =
      "# praxis.yaml — the methodology installed in this repo (the declarative truth).\n" +
      "# Edit this, then run `praxis sync`. `praxis check` reports drift.\n" +
      "version: 1\n" +
      'methodology: "0.1.0"\n' +
      "stacks: [node]\n" +
      "targets: [claude-code, agents-md]\n" +
      "packages: [karpathy-claude, node-recipes]\n";
    expect(renderManifestYaml(manifest)).toBe(expected);
  });

  it("renders a workspace section that round-trips through parseManifest (member with explicit name, empty edges)", () => {
    const manifest: Manifest = {
      version: 1,
      methodology: "0.1.0",
      targets: ["claude-code"],
      packages: ["karpathy-claude", "workspace", "wiki-memory", "upkeep", "session-handoff"],
      workspace: {
        members: [{ path: "api" }, { path: "frontend", name: "web" }],
        edges: [],
      },
    };
    const yaml = renderManifestYaml(manifest);
    expect(yaml).toContain("workspace:");
    expect(parseManifest(yaml)).toEqual(manifest);
  });

  it("renders a workspace section with edges that round-trips through parseManifest", () => {
    const manifest: Manifest = {
      version: 1,
      methodology: "0.1.0",
      targets: ["claude-code"],
      packages: ["karpathy-claude", "workspace", "wiki-memory", "upkeep", "session-handoff"],
      workspace: {
        members: [{ path: "api" }, { path: "frontend" }],
        edges: [{ from: "api", to: "frontend", contract: "docs/wiki/contracts/api-to-frontend.md" }],
      },
    };
    expect(parseManifest(renderManifestYaml(manifest))).toEqual(manifest);
  });

  it("defaultManifest for a bare repo includes all layer1 packages and no layer2", () => {
    const dir = tempDir();
    const ctx = detectContext(dir);
    const manifest = defaultManifest(ctx);
    // No stacks detected — no layer2 packages
    expect(manifest.stacks).toBeUndefined();
    for (const pkg of manifest.packages) {
      // All packages should be layer1 (no layer2 in a bare repo)
      expect(pkg).not.toMatch(/^(node-recipes|node-testing|python-backend-recipes|python-testing|react-components|react-testing)$/);
    }
  });

  it("defaultManifest for a node repo includes node layer2 packages", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app" }), "utf8");
    const ctx = detectContext(dir);
    const manifest = defaultManifest(ctx);
    expect(manifest.stacks).toEqual(["node"]);
    expect(manifest.packages).toContain("node-recipes");
    expect(manifest.packages).toContain("node-testing");
    expect(manifest.packages).not.toContain("python-backend-recipes");
    expect(manifest.packages).not.toContain("react-components");
  });

  it("defaultManifest for a react repo includes node and react layer2 packages", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^18.0.0" } }),
      "utf8",
    );
    const ctx = detectContext(dir);
    const manifest = defaultManifest(ctx);
    expect(manifest.stacks).toEqual(["node", "react"]);
    expect(manifest.packages).toContain("node-recipes");
    expect(manifest.packages).toContain("node-testing");
    expect(manifest.packages).toContain("react-components");
    expect(manifest.packages).toContain("react-testing");
    expect(manifest.packages).not.toContain("python-backend-recipes");
  });

  it("previewInit writes nothing", () => {
    const dir = tempDir();
    const preview = previewInit(dir);
    expect(preview.report.changed).toBe(true);
    expect(existsSync(join(dir, "praxis.yaml"))).toBe(false);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("manifestFromSelections builds a valid manifest that round-trips through parseManifest", () => {
    const manifest = manifestFromSelections(["node"], ["karpathy-claude", "node-recipes"], [
      "claude-code",
    ]);
    expect(manifest.version).toBe(1);
    expect(manifest.stacks).toEqual(["node"]);
    expect(manifest.packages).toEqual(["karpathy-claude", "node-recipes"]);
    expect(manifest.targets).toEqual(["claude-code"]);
    // Round-trip: render → parse must produce the same manifest
    expect(parseManifest(renderManifestYaml(manifest))).toEqual(manifest);
  });

  it("manifestFromSelections omits stacks when the array is empty", () => {
    const manifest = manifestFromSelections([], ["karpathy-claude"], ["claude-code", "agents-md"]);
    expect(manifest.stacks).toBeUndefined();
    expect(parseManifest(renderManifestYaml(manifest))).toEqual(manifest);
  });

  it("manifestFromSelections sets the workspace section when provided", () => {
    const workspace: Workspace = { members: [{ path: "api" }], edges: [] };
    const manifest = manifestFromSelections(
      ["node"],
      ["karpathy-claude", "workspace", "wiki-memory", "upkeep", "session-handoff"],
      ["claude-code"],
      workspace,
    );
    expect(manifest.workspace).toEqual(workspace);
    expect(parseManifest(renderManifestYaml(manifest))).toEqual(manifest);
  });

  it("manifestFromSelections omits workspace when not provided", () => {
    const manifest = manifestFromSelections(["node"], ["karpathy-claude"], ["claude-code"]);
    expect(manifest.workspace).toBeUndefined();
  });

  it("defaultManifest honors an explicit non-interactive target override", () => {
    const manifest = defaultManifest(detectContext(tempDir(), ""), ["codex", "agents-md"]);
    expect(manifest.targets).toEqual(["codex", "agents-md"]);
  });

  it("requires onboarding when any selected first-class target lacks its surface", () => {
    const codexOnly = manifestFromSelections([], ["karpathy-claude"], ["codex"]);
    expect(needsSetupSentinel({ hasClaudeMd: true, hasAgentsMd: false }, codexOnly)).toBe(true);
    expect(needsSetupSentinel({ hasClaudeMd: false, hasAgentsMd: true }, codexOnly)).toBe(false);

    const both = manifestFromSelections([], ["karpathy-claude"], ["claude-code", "codex"]);
    expect(needsSetupSentinel({ hasClaudeMd: true, hasAgentsMd: false }, both)).toBe(true);
    expect(needsSetupSentinel({ hasClaudeMd: true, hasAgentsMd: true }, both)).toBe(true);
    expect(needsSetupSentinel({
      hasClaudeMd: true,
      hasAgentsMd: true,
      hasClaudeSharedProject: true,
      hasAgentsSharedProject: true,
    }, both)).toBe(false);
  });

  it("detects peer-native shared project blocks", () => {
    const dir = tempDir();
    const shared = `${SHARED_PROJECT_BEGIN}\n# Project\n${SHARED_PROJECT_END}\n`;
    writeFileSync(join(dir, "CLAUDE.md"), shared, "utf8");
    writeFileSync(join(dir, "AGENTS.md"), shared, "utf8");
    expect(detectContext(dir)).toMatchObject({
      hasClaudeSharedProject: true,
      hasAgentsSharedProject: true,
    });
  });

  it("applyInit writes praxis.yaml and emits methodology, then check is clean", () => {
    const dir = tempDir();
    const ctx = detectContext(dir);
    applyInit(dir, defaultManifest(ctx), ctx);
    // Bare repo gets all layer1 packages; karpathy-claude is one of them
    expect(readFileSync(join(dir, "praxis.yaml"), "utf8")).toMatch(/karpathy-claude/);
    expect(existsSync(join(dir, ".claude/rules/praxis-karpathy-claude.md"))).toBe(true);
    expect(runSync({ cwd: dir, write: false }).changed).toBe(false);
  });
});
