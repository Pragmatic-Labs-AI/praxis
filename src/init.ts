import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, delimiter, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { STACKS, type Manifest, type Stack, type Target, type Workspace } from "./manifest.js";
import { availablePackages } from "./packages.js";
import { hasSharedProjectBlock } from "./shared-instructions.js";
import { applyManifest, type SyncReport } from "./sync.js";
import { praxisVersion } from "./version.js";

/**
 * `init` — the first-run install (docs/wiki/interaction-model.md, D17). Minimal by design:
 * detect context → propose a default manifest → preview the emit → write
 * `praxis.yaml` and apply. Stack/target selection and filesystem/PATH detection
 * stay here as testable logic; prompts remain in program.ts.
 *
 * This module is pure logic; the interactive prompts live in src/program.ts.
 */

export interface InitContext {
  hasGit: boolean;
  hasClaudeMd: boolean;
  hasAgentsMd: boolean;
  hasClaudeSharedProject: boolean;
  hasAgentsSharedProject: boolean;
  /** Emit targets inferred from project artifacts and installed CLIs — for
   *  interactive suggestion only; a PATH-installed CLI is a per-machine signal. */
  detectedTargets: Target[];
  /** Emit targets inferred from repo artifacts alone (no PATH probing) — the
   *  reproducible subset, used to default non-interactive (`--yes`) installs
   *  so the same repo yields the same manifest regardless of the machine. */
  detectedTargetsFromArtifacts: Target[];
  /** A `praxis.yaml` already exists — init should defer to `sync`. */
  manifestExists: boolean;
  /** Stacks detected from project files. Empty for a bare/unrecognised repo. */
  detectedStacks: Stack[];
  /** Immediate subdirectories that look like independent git repos (a `.git`
   *  dir or file — worktrees use a file) — candidates for a workspace hub's
   *  `workspace:` members (D53 WS4). Dot-directories excluded; sorted for
   *  determinism. Empty for a repo with no nested repos. Detection only —
   *  never used to auto-enable the workspace section; that stays an explicit
   *  wizard opt-in (see `runInit` in src/program.ts). */
  detectedMembers: string[];
}

const MANIFEST_FILE = "praxis.yaml";

function executableOnPath(name: string, pathValue: string): boolean {
  const suffixes = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  return pathValue.split(delimiter).some((dir) =>
    suffixes.some((suffix) => dir.length > 0 && existsSync(join(dir, `${name}${suffix}`))),
  );
}

export function detectContext(cwd: string, pathValue = process.env.PATH ?? ""): InitContext {
  const has = (rel: string): boolean => existsSync(join(cwd, rel));

  const stacks: Stack[] = [];

  // python-backend: pyproject.toml, requirements.txt, or setup.py
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) {
    stacks.push("python-backend");
  }

  // node: package.json present
  if (has("package.json")) {
    stacks.push("node");

    // react: package.json has "react" in dependencies or devDependencies
    try {
      const raw = readFileSync(join(cwd, "package.json"), "utf8");
      const pkg = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if ("react" in deps) {
        stacks.push("react");
      }
    } catch {
      // malformed or missing — no node/react crash; node is already pushed above
    }
  }

  // Return in canonical STACKS order for determinism
  const ordered = STACKS.filter((s) => stacks.includes(s));
  const hasClaudeArtifacts = has("CLAUDE.md") || has(".claude");
  const hasCodexArtifacts = has(".codex") || has(".agents/skills");
  const hasAgentsArtifacts = has("AGENTS.md");

  const detectedTargetsFromArtifacts: Target[] = [];
  if (hasClaudeArtifacts) detectedTargetsFromArtifacts.push("claude-code");
  if (hasCodexArtifacts) detectedTargetsFromArtifacts.push("codex");
  if (hasAgentsArtifacts) detectedTargetsFromArtifacts.push("agents-md");

  const detectedTargets: Target[] = [];
  if (hasClaudeArtifacts || executableOnPath("claude", pathValue)) detectedTargets.push("claude-code");
  if (hasCodexArtifacts || executableOnPath("codex", pathValue)) detectedTargets.push("codex");
  if (hasAgentsArtifacts) detectedTargets.push("agents-md");

  // Sibling-repo detection (D53 WS4): an immediate subdirectory with a `.git`
  // dir or file (worktrees use a file — existsSync covers both) is a
  // candidate workspace member. Mirrors the try/catch-around-fs-read style
  // above; an unreadable cwd yields no members rather than a crash.
  let detectedMembers: string[] = [];
  try {
    detectedMembers = readdirSync(cwd, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .filter((entry) => existsSync(join(cwd, entry.name, ".git")))
      .map((entry) => entry.name)
      .sort();
  } catch {
    // unreadable directory — leave detectedMembers empty
  }

  return {
    hasGit: has(".git"),
    hasClaudeMd: has("CLAUDE.md"),
    hasAgentsMd: has("AGENTS.md"),
    hasClaudeSharedProject: has("CLAUDE.md")
      ? hasSharedProjectBlock(readFileSync(join(cwd, "CLAUDE.md"), "utf8"))
      : false,
    hasAgentsSharedProject: has("AGENTS.md")
      ? hasSharedProjectBlock(readFileSync(join(cwd, "AGENTS.md"), "utf8"))
      : false,
    detectedTargets,
    detectedTargetsFromArtifacts,
    manifestExists: has(MANIFEST_FILE),
    detectedStacks: ordered,
    detectedMembers,
  };
}

/**
 * The default manifest for a fresh repo: all Layer 1 packages + Layer 2 packages
 * for the detected stacks. Data-driven from availablePackages(); no hardcoded list.
 * Uses detected targets, retaining the legacy Claude + generic fallback.
 */
export function defaultManifest(ctx: InitContext, targets?: Target[]): Manifest {
  const all = availablePackages();
  // Typed <string>, not <Stack>: package.yaml's `stack` field now also accepts
  // the derived "workspace" pseudo-stack (D53, src/packages.ts), which is never
  // in `ctx.detectedStacks` — widening this Set's element type is the minimal
  // fix so `.has(pkg.stack)` below still type-checks, with no behavior change.
  const detectedSet = new Set<string>(ctx.detectedStacks);

  const layer1: string[] = [];
  const layer2: string[] = [];
  for (const [name, pkg] of all) {
    if (pkg.layer === "layer1") {
      layer1.push(name);
    } else if (pkg.layer === "layer2" && pkg.stack && detectedSet.has(pkg.stack)) {
      layer2.push(name);
    }
    // external and decision: excluded from quick-start
  }

  layer1.sort();
  layer2.sort();

  const manifest: Manifest = {
    version: 1,
    methodology: praxisVersion(),
    targets:
      targets ??
      (ctx.detectedTargetsFromArtifacts.length > 0 ? ctx.detectedTargetsFromArtifacts : ["claude-code", "agents-md"]),
    packages: [...layer1, ...layer2],
  };
  if (ctx.detectedStacks.length > 0) {
    manifest.stacks = ctx.detectedStacks;
  }
  return manifest;
}

/**
 * Build a manifest from explicit selections (Customize branch). Pure — no I/O, no prompts.
 * Omits `stacks` when the array is empty. `workspace` (D53 WS4) is optional and
 * set only when the wizard's workspace confirm was accepted.
 */
export function manifestFromSelections(
  stacks: Stack[],
  packages: string[],
  targets: Target[],
  workspace?: Workspace,
): Manifest {
  const manifest: Manifest = {
    version: 1,
    methodology: praxisVersion(),
    targets,
    packages,
  };
  if (stacks.length > 0) {
    manifest.stacks = stacks;
  }
  if (workspace !== undefined) {
    manifest.workspace = workspace;
  }
  return manifest;
}

/** Render a manifest as a commented `praxis.yaml`. Hand-written (not yaml.stringify)
 *  so the file carries guidance for the human who owns it. */
export function renderManifestYaml(manifest: Manifest): string {
  const lines = [
    "# praxis.yaml — the methodology installed in this repo (the declarative truth).",
    "# Edit this, then run `praxis sync`. `praxis check` reports drift.",
    `version: ${manifest.version}`,
    `methodology: "${manifest.methodology}"`,
  ];
  if (manifest.stacks?.length) lines.push(`stacks: [${manifest.stacks.join(", ")}]`);
  lines.push(`targets: [${manifest.targets.join(", ")}]`);
  lines.push(`packages: [${manifest.packages.join(", ")}]`);
  if (manifest.workspace) {
    lines.push("");
    lines.push(
      "# Hub-sovereign workspace tier (D53): independent git repos cloned beneath this",
    );
    lines.push(
      "# repo. `members` were detected for you; fill in `edges` yourself — producer ->",
    );
    lines.push(
      "# consumer, with an optional `contract:` wiki page — that's a call only you can make.",
    );
    lines.push("workspace:");
    lines.push("  members:");
    for (const member of manifest.workspace.members) {
      lines.push(`    - path: ${member.path}`);
      if (member.name !== undefined && member.name !== basename(member.path)) {
        lines.push(`      name: ${member.name}`);
      }
    }
    if (manifest.workspace.edges.length > 0) {
      lines.push("  edges:");
      for (const edge of manifest.workspace.edges) {
        lines.push(`    - from: ${edge.from}`);
        lines.push(`      to: ${edge.to}`);
        if (edge.contract !== undefined) {
          lines.push(`      contract: ${edge.contract}`);
        }
      }
    } else {
      lines.push("  edges: []");
    }
  }
  return `${lines.join("\n")}\n`;
}

export interface InitPreview {
  ctx: InitContext;
  manifest: Manifest;
  manifestYaml: string;
  /** Dry-run emit report: what files init would create/update. */
  report: SyncReport;
  /**
   * True when init would write the `.praxis-setup-pending` sentinel (fresh repo
   * with no `CLAUDE.md` + `claude-code` in targets). WS1 uses this to surface
   * the pending sentinel in the outro.
   */
  willWriteSentinel: boolean;
}

/** Compute everything init would do, writing nothing. */
export function previewInit(cwd: string): InitPreview {
  const ctx = detectContext(cwd);
  const manifest = defaultManifest(ctx);
  return {
    ctx,
    manifest,
    manifestYaml: renderManifestYaml(manifest),
    report: applyManifest(manifest, cwd, false),
    willWriteSentinel: needsSetupSentinel(ctx, manifest),
  };
}

/** The transient sentinel written on fresh installs (D14). The onboarding bootstrap
 *  rule triggers `/praxis-onboard`, which deletes it when done — one-shot, never
 *  a managed/synced file. */
export const SETUP_SENTINEL = ".praxis-setup-pending";

const SENTINEL_CONTENT = `# .praxis-setup-pending
#
# This file was written by \`praxis init\` to signal that project-owned sections
# of the selected agent instruction surfaces haven't been authored yet.
#
# At the start of the next session your AI coding agent will offer to run
# the Praxis onboarding workflow, which guides you through writing build/run/test commands,
# project layout, conventions, and always-do rules for this repo.
#
# The onboarding workflow deletes this file when it finishes — making onboarding
# one-shot. You can also delete this file yourself to skip onboarding.
`;

/**
 * Write the transient `.praxis-setup-pending` sentinel directly (outside the
 * sync/emit pipeline) so `praxis check` never treats it as drift. Called only
 * when `!ctx.hasClaudeMd && manifest.targets.includes("claude-code")`.
 */
export function writeSetupSentinel(cwd: string): void {
  writeFileSync(join(cwd, SETUP_SENTINEL), SENTINEL_CONTENT, "utf8");
}

export function needsSetupSentinel(
  ctx: Pick<InitContext, "hasClaudeMd" | "hasAgentsMd"> &
    Partial<Pick<InitContext, "hasClaudeSharedProject" | "hasAgentsSharedProject">>,
  manifest: Manifest,
): boolean {
  const dualFirstClass = manifest.targets.includes("claude-code") && manifest.targets.includes("codex");
  return (
    (manifest.targets.includes("claude-code") && !ctx.hasClaudeMd) ||
    (manifest.targets.includes("codex") && !ctx.hasAgentsMd) ||
    (dualFirstClass && (!ctx.hasClaudeSharedProject || !ctx.hasAgentsSharedProject))
  );
}

/** Write `praxis.yaml`, apply the methodology files, and — for a fresh
 *  Claude Code repo with no CLAUDE.md — write the onboarding sentinel (D14). */
export function applyInit(
  cwd: string,
  manifest: Manifest,
  ctx: Pick<InitContext, "hasClaudeMd" | "hasAgentsMd"> &
    Partial<Pick<InitContext, "hasClaudeSharedProject" | "hasAgentsSharedProject">>,
): SyncReport {
  const path = join(cwd, MANIFEST_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderManifestYaml(manifest), "utf8");
  const report = applyManifest(manifest, cwd, true);
  if (needsSetupSentinel(ctx, manifest)) {
    writeSetupSentinel(cwd);
  }
  return report;
}
