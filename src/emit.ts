import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Manifest, Target } from "./manifest.js";
import { reconcile } from "./merge.js";
import { resolveMethodology } from "./methodology.js";
import {
  BUCKETS,
  type DesiredSettings,
  type MarketplaceEntry,
  type PluginsDesired,
  reconcileSettings,
  type RuleSet,
} from "./merge-json.js";
import { resolvePackages } from "./packages.js";
import { resolveContained } from "./path-safety.js";
import { praxisVersion } from "./version.js";
import { type Capability, loadPolicy, type Policy } from "./permissions.js";
import { loadPluginsBlock } from "./plugins.js";
import { reconcileCodexConfig, renderCodexRules } from "./codex-security.js";
import {
  CODEX_MARKETPLACE_PATH,
  CODEX_MARKETPLACE_STATE_PATH,
  type CodexPluginEntry,
} from "./codex-marketplace.js";

/**
 * Layer 1 emit (CLAUDE.md non-negotiable "tool-neutral by construction";
 * docs/wiki/merge-engine.md / docs/wiki/emitters.md, decisions D7/D13). The methodology source is **singular
 * and tool-neutral**; emitters *translate* it per target — they never fork the
 * content.
 *
 * Two delivery shapes, per target:
 *   - "owned": Praxis owns whole files (place/replace, no merge). Claude Code
 *     methodology ships as `.claude/rules/praxis-*.md`, auto-loaded every
 *     session; Praxis never edits the user's CLAUDE.md (D13).
 *   - "block": content is inlined into a flat instruction file via a managed
 *     block (merge engine). Used for AGENTS.md, which has no include standard.
 *
 * Package layout (D16): packages/<layer>/<pkg>/rules.md. `../packages/` resolves
 * the same from src/ (dev/vitest) and dist/ (built/installed) — both one level
 * under repo root.
 */

type Delivery = "owned" | "block";

// Where each target's methodology lives, and how it is delivered.
const TARGET_DELIVERY: Record<Target, Delivery> = {
  "claude-code": "owned",
  codex: "block",
  "agents-md": "block",
};

// Block-delivered targets each own a managed block in one flat file. Exported
// so sync.ts can enumerate the universe of block-owned files for orphan
// pruning even when the current manifest emits zero blocks for one (D46) —
// planEmit's ops alone wouldn't carry that path in that case.
export const BLOCK_FILE: Partial<Record<Target, string>> = {
  codex: "AGENTS.md",
  "agents-md": "AGENTS.md",
};

/** The neutral methodology source for a content package, or undefined if the
 *  package has no rules.md (e.g. skills, Layer 2 recipes handled by other phases).
 *  `dir` is the package's own directory (`ResolvedPackage.dir`) — shipped or
 *  project-local, resolved identically either way.
 *
 *  Contained to `dir` (D54): a project-local package's rules.md could
 *  be a symlink pointing outside its own directory — refuse rather than read
 *  through it and embed arbitrary external content into an emitted file. */
export function loadPackageSource(dir: string): string | undefined {
  const candidate = resolveContained(dir, "rules.md", "package rules.md");
  return existsSync(candidate) ? readFileSync(candidate, "utf8").trimEnd() : undefined;
}

/** Translate neutral source for a specific target. The seam for per-tool
 *  framing; Layer 1 prose is identical across tools today. */
function renderNeutralSyntax(source: string, target: Target): string {
  return source
    .replace(/\{\{workflow:([^}]+)\}\}/g, (_match, name: string) => `${target === "codex" ? "$" : "/"}${name}`)
    .replace(/\{\{shell:([^}]+)\}\}/g, (_match, command: string) => target === "codex" ? `run \`${command}\`` : `!\`${command}\``)
    .replaceAll("{{arguments}}", target === "codex" ? "the arguments supplied with this skill" : "$ARGUMENTS");
}

function renderForTarget(source: string, target: Target): string {
  source = renderNeutralSyntax(source, target);
  if (target === "codex") {
    const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
    if (match) {
      const frontmatter = parseYaml(match[1]!) as { paths?: unknown } | null;
      if (Array.isArray(frontmatter?.paths) && frontmatter.paths.every((path) => typeof path === "string")) {
        const paths = frontmatter.paths.map((path) => `\`${path}\``).join(", ");
        return `Applies only when working on files matching: ${paths}.\n\n${source.slice(match[0].length).trimStart()}`;
      }
    }
  }
  return source;
}

function renderCodexSkill(name: string, source: string): string {
  source = renderNeutralSyntax(source, "codex");
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  const descriptionMatch = match?.[1]?.match(/^description:\s*(.+)$/m);
  const description = descriptionMatch?.[1]?.trim() ?? `Run the Praxis ${name} workflow.`;
  let body = match ? source.slice(match[0].length).trimStart() : source;
  body = body
    .replaceAll("/praxis-", "$praxis-")
    .replaceAll("$ARGUMENTS", "the arguments supplied with this skill")
    .replace(/^\s*- ([^:]+): !`([^`]+)`$/gm, "- $1: run `$2`");
  return `---\nname: praxis-${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.trimEnd()}\n`;
}

/** A package's workflow sources: one file per workflow, named for its target-native invocation. */
export interface CommandSource {
  name: string;
  content: string;
}

/** A content package's commands, or [] if it has none. Scans
 *  `<dir>/commands/*.md` — mirrors loadPackageSource, including its D54
 *  containment: the commands dir and every file in it are resolved against
 *  the package's own directory, so neither a symlinked `commands/` nor a
 *  symlinked command file can pull external content into an emitted file. */
export function loadCommandSources(dir: string): CommandSource[] {
  const commandsDir = resolveContained(dir, "commands", "package commands directory");
  if (!existsSync(commandsDir)) return [];
  return readdirSync(commandsDir, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith(".md"))
    .map((f) => ({
      name: f.name.slice(0, -3),
      content: readFileSync(
        resolveContained(dir, join("commands", f.name), `package command ${f.name}`),
        "utf8",
      ).trimEnd(),
    }));
}

/** Targets that consume the source directly as slash-command markdown. Codex
 *  uses the separate SKILL.md renderer below. */
const COMMAND_DIR: Partial<Record<Target, string>> = {
  "claude-code": ".claude/commands",
};

/**
 * Claude Code permission emitter (docs/wiki/emitters.md — *quarantined per-tool*;
 * D19). Maps each neutral capability to concrete Claude Code rule strings.
 * Grammar verified against code.claude.com/docs/en/settings: `Tool(pattern)`,
 * gitignore-style path globs, `:*` command-prefix wildcard, `deny` overrides
 * `allow`. The bucket (allow/ask/deny) is chosen by the policy, not here — this
 * table only knows the rule strings a capability denotes.
 *
 * `pipe-network-to-shell` (e.g. `curl … | sh`) is deliberately NOT a capability:
 * prefix-matched rules cannot reliably catch a pipe, and a denylist that looks
 * protective but isn't is worse than none (the "denylist delusion"). Excluded by
 * the content bar (durable + verified) rather than emitted as a false guarantee.
 */
const CLAUDE_CODE_RULES: Record<Capability, string[]> = {
  "read-repo": ["Read(./**)"],
  "edit-repo": ["Edit(./**)", "Write(./**)"],
  "run-dev-scripts": [
    "Bash(npm run test:*)",
    "Bash(npm run lint:*)",
    "Bash(npm run typecheck:*)",
    "Bash(npm run build:*)",
  ],
  "read-only-git": ["Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)"],
  "git-commit": ["Bash(git commit:*)"],
  "git-push": ["Bash(git push:*)"],
  "install-deps": ["Bash(npm install:*)", "Bash(npm i:*)", "Bash(npm ci:*)"],
  "destructive-delete": ["Bash(rm -rf:*)"],
  "force-push": ["Bash(git push --force:*)", "Bash(git push -f:*)"],
  "read-secrets": ["Read(./.env)", "Read(./.env.*)", "Read(./**/*.pem)", "Read(./**/credentials*)"],
  "global-install": ["Bash(npm install -g:*)", "Bash(npm i -g:*)", "Bash(pnpm add -g:*)"],
};

/** Render a neutral policy into Claude Code's allow/ask/deny rule strings. */
function toClaudeRuleSet(policy: Policy): RuleSet {
  const out: RuleSet = { allow: [], ask: [], deny: [] };
  for (const bucket of BUCKETS) {
    for (const cap of policy[bucket]) {
      for (const rule of CLAUDE_CODE_RULES[cap]) {
        if (!out[bucket].includes(rule)) out[bucket].push(rule);
      }
    }
  }
  return out;
}

/** Targets with a permission model, and where the rendered policy lands. A
 *  target absent here has no Claude settings permission model. Codex security
 *  is emitted independently below. Shares a path
 *  with PLUGIN_EMITTERS below — both concerns compose into one settings op per
 *  target (see the single `kind: "settings"` EmitOp). */
const PERMISSION_EMITTERS: Partial<Record<Target, { path: string; render: (policy: Policy) => RuleSet }>> = {
  "claude-code": { path: ".claude/settings.json", render: toClaudeRuleSet },
};

/** Targets with a Claude Code plugin-marketplace model, and where the
 *  declaration lands. A target absent here has no plugin model (e.g.
 *  agents-md, a flat-file convention with no marketplace concept) → Praxis
 *  emits nothing for it. Codex marketplace delivery is handled separately. */
const PLUGIN_EMITTERS: Partial<Record<Target, { path: string }>> = {
  "claude-code": { path: ".claude/settings.json" },
};

/** A planned write. "owned" files are placed/replaced wholesale; "block" files
 *  have their managed blocks reconciled into existing text; "settings" carries
 *  whichever of permissions/plugins this target emits — always exactly one op
 *  per target per settings path, so the two concerns compose into a single
 *  write instead of racing on the same file. */
export type EmitOp =
  | { kind: "owned"; target: Target; path: string; content: string }
  | { kind: "block"; target: Target; path: string; blocks: Record<string, string> }
  | { kind: "settings"; target: Target; path: string; rules?: RuleSet; plugins?: PluginsDesired }
  | { kind: "codex-config"; target: "codex"; path: ".codex/config.toml"; enabled: boolean }
  | {
      kind: "codex-marketplace";
      target: "codex";
      path: typeof CODEX_MARKETPLACE_PATH;
      statePath: typeof CODEX_MARKETPLACE_STATE_PATH;
      plugins: CodexPluginEntry[];
    };

/** Build the emit plan from a manifest: the file operations needed to install
 *  the selected methodology for each target. `cwd` resolves any project-local
 *  (`./`-prefixed) packages the manifest names; defaults to process.cwd(). */
export function planEmit(manifest: Manifest, cwd: string = process.cwd()): EmitOp[] {
  // Validate the pinned methodology version up front (A1, docs/wiki/decisions.md
  // D6/D42): equal is a no-op; a stale pin surfaces as a distinct "upgrade
  // available" condition `sync` can offer to resolve; a bogus or
  // ahead-of-the-running-CLI pin fails loudly here, not silently later —
  // same posture as the package-resolution validation immediately below.
  resolveMethodology(manifest.methodology, praxisVersion());

  // Validate the package set and resolve requires/conflicts up front (D20/D21):
  // an unknown package or unmet dependency fails loudly here, not silently later.
  // "workspace" is derived, never user-declarable in `stacks` (D53): a package
  // targeting it gates on whether the manifest has a `workspace:` section, not
  // on anything the user lists in `stacks` themselves — single declaration.
  const declaredStacks = [...(manifest.stacks ?? []), ...(manifest.workspace ? ["workspace"] : [])];
  const packages = resolvePackages(manifest.packages, declaredStacks, cwd);
  const rulesPackages = packages.filter((p) => p.provides.includes("rules"));
  const permissionPackages = packages.filter((p) => p.provides.includes("permissions"));
  const commandPackages = packages.filter((p) => p.provides.includes("commands"));
  const pluginPackages = packages.filter((p) => p.provides.includes("plugins"));

  const ops: EmitOp[] = [];
  const codexSelected = manifest.targets.includes("codex");
  for (const target of manifest.targets) {
    // Prose rules — delivery (owned vs block) is the target's; `provides` decides
    // which packages contribute. `loadPackageSource` is guaranteed by `provides`.
    const sources = rulesPackages.map((p) => ({ pkg: p.name, source: loadPackageSource(p.dir) ?? "" }));
    if (sources.length > 0 && !(target === "agents-md" && codexSelected)) {
      if (TARGET_DELIVERY[target] === "owned") {
        for (const { pkg, source } of sources) {
          ops.push({
            kind: "owned",
            target,
            path: `.claude/rules/praxis-${pkg}.md`,
            content: `${renderForTarget(source, target)}\n`,
          });
        }
      } else {
        const blocks: Record<string, string> = {};
        for (const { pkg, source } of sources) blocks[pkg] = renderForTarget(source, target);
        ops.push({ kind: "block", target, path: BLOCK_FILE[target] as string, blocks });
      }
    }

    // Structured permission policy (second artifact kind, docs/wiki/packages-and-emit.md "provides")
    // and the plugin-marketplace declaration (fourth artifact kind) both land in
    // `.claude/settings.json`. Compute each independently, but emit at most ONE
    // settings op per target so the two concerns compose into a single write
    // instead of two ops racing on the same path (the same-file compose bug).
    const permEmitter = PERMISSION_EMITTERS[target];
    let rules: RuleSet | undefined;
    if (permEmitter && permissionPackages.length > 0) {
      rules = { allow: [], ask: [], deny: [] };
      for (const p of permissionPackages) {
        const policy = loadPolicy(p.dir);
        if (!policy) continue;
        const r = permEmitter.render(policy);
        for (const bucket of BUCKETS) {
          for (const rule of r[bucket]) if (!rules[bucket].includes(rule)) rules[bucket].push(rule);
        }
      }
    }

    const pluginEmitter = PLUGIN_EMITTERS[target];
    let plugins: PluginsDesired | undefined;
    if (pluginEmitter && pluginPackages.length > 0) {
      const marketplaces: MarketplaceEntry[] = [];
      const enable: string[] = [];
      for (const p of pluginPackages) {
        const block = loadPluginsBlock(p.dir);
        if (!block || !block.targets.includes(target)) continue;
        if (!marketplaces.some((m) => m.name === block.marketplace.name)) {
          marketplaces.push(block.marketplace);
        }
        for (const entry of block.enable) if (!enable.includes(entry)) enable.push(entry);
      }
      if (marketplaces.length > 0 || enable.length > 0) plugins = { marketplaces, enable };
    }

    const settingsPath = permEmitter?.path ?? pluginEmitter?.path;
    if (settingsPath && (rules || plugins)) {
      ops.push({ kind: "settings", target, path: settingsPath, rules, plugins });
    }

    if (target === "codex") {
      const policies = permissionPackages.map((pkg) => loadPolicy(pkg.dir)).filter((p): p is Policy => Boolean(p));
      if (policies.length > 0) {
        ops.push({ kind: "codex-config", target, path: ".codex/config.toml", enabled: true });
        const combined: Policy = { allow: [], ask: [], deny: [] };
        for (const policy of policies) {
          for (const bucket of BUCKETS) {
            for (const capability of policy[bucket]) {
              if (!combined[bucket].includes(capability)) combined[bucket].push(capability);
            }
          }
        }
        ops.push({
          kind: "owned",
          target,
          path: ".codex/rules/praxis-safe-permissions.rules",
          content: renderCodexRules(combined),
        });
      }

      const codexPlugins: CodexPluginEntry[] = [];
      for (const pkg of pluginPackages) {
        const block = loadPluginsBlock(pkg.dir);
        if (!block?.codex) continue;
        const source: Record<string, string> = block.codex.subdir
          ? {
              source: "git-subdir",
              url: `https://github.com/${block.marketplace.source.repo}.git`,
              path: block.codex.subdir.startsWith("./") ? block.codex.subdir : `./${block.codex.subdir}`,
            }
          : { source: "url", url: `https://github.com/${block.marketplace.source.repo}.git` };
        if (block.marketplace.source.ref) source.ref = block.marketplace.source.ref;
        if (block.marketplace.source.sha) source.sha = block.marketplace.source.sha;
        codexPlugins.push({
          name: block.codex.name,
          source,
          policy: {
            installation: block.codex.installation,
            authentication: block.codex.authentication,
          },
          category: block.codex.category,
        });
      }
      if (codexPlugins.length > 0) {
        ops.push({
          kind: "codex-marketplace",
          target,
          path: CODEX_MARKETPLACE_PATH,
          statePath: CODEX_MARKETPLACE_STATE_PATH,
          plugins: codexPlugins,
        });
      }
    }

    // Slash commands (third artifact kind, docs/wiki/packages-and-emit.md "provides"). One owned file per
    // command, prefixed so it's identifiable as Praxis-managed; targets with no
    // command model are a no-op.
    //
    // Bootstrap-delegation splice (D36): any command source containing the marker
    // <!-- praxis:bootstrap-delegations --> gets it replaced with a bullet list of
    // every selected package that declares an `onboarding` hook. If no package
    // declares one, the marker is replaced with nothing (section prose still reads).
    // Commands without the marker are copied verbatim. Generic — not special-cased
    // to any package name.
    const onboardingDelegations = packages
      .filter((p) => p.onboarding)
      .map((p) => `- \`${target === "codex" ? "$" : "/"}${p.onboarding!.command}\` — ${p.onboarding!.summary}`)
      .join("\n");
    const BOOTSTRAP_MARKER = "<!-- praxis:bootstrap-delegations -->";

    const commandDir = COMMAND_DIR[target];
    if (commandDir) {
      for (const pkg of commandPackages) {
        for (const { name, content } of loadCommandSources(pkg.dir)) {
          const emitted = content.includes(BOOTSTRAP_MARKER)
            ? content.replace(BOOTSTRAP_MARKER, onboardingDelegations)
            : content;
          ops.push({
            kind: "owned",
            target,
            path: `${commandDir}/praxis-${name}.md`,
            content: `${renderNeutralSyntax(emitted, target)}\n`,
          });
        }
      }
    }
    if (target === "codex") {
      for (const pkg of commandPackages) {
        for (const { name, content } of loadCommandSources(pkg.dir)) {
          const emitted = content.includes(BOOTSTRAP_MARKER)
            ? content.replace(BOOTSTRAP_MARKER, onboardingDelegations)
            : content;
          ops.push({
            kind: "owned",
            target,
            path: `.agents/skills/praxis-${name}/SKILL.md`,
            content: renderCodexSkill(name, emitted),
          });
        }
      }
    }
  }
  return ops;
}

export interface MethodologySize {
  /** Total content lines across the counted rule artifacts. */
  totalLines: number;
  /** Number of always-loaded rule artifacts counted. */
  fileCount: number;
}

/** Lines in `text`, ignoring any trailing newline(s) — so an owned file's
 *  synthesized trailing "\n" (see planEmit above) doesn't inflate the count. */
function countLines(text: string): number {
  const trimmed = text.replace(/\n+$/, "");
  return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
}

/**
 * The always-loaded methodology surface size: total lines and file count for
 * the rule artifacts (`provides: rules`) a session loads at start. Computed
 * from the **planned emit** (manifest → resolve → planEmit), not from files on
 * disk, so it reports what the manifest implies — the same discipline `check`
 * already uses for drift.
 *
 * Counts the claude-code target's owned `.claude/rules/*` files (one per rules
 * package). If claude-code isn't a manifest target, falls back to the
 * Codex/agents-md managed block content, one artifact per block, so the targets'
 * shared source is never double-counted. Commands, permissions/plugins JSON,
 * and the wiki are never counted — none are loaded at session start.
 *
 * Throws if the manifest can't resolve (propagates planEmit's error, e.g. an
 * unknown package) — callers in check mode should catch and omit the line
 * rather than let it mask the sync error (D40's degrade-by-omission model).
 */
export function computeMethodologySize(manifest: Manifest, cwd: string = process.cwd()): MethodologySize {
  const ops = planEmit(manifest, cwd);

  const claudeRuleFiles = ops.filter(
    (op) => op.kind === "owned" && op.target === "claude-code" && op.path.startsWith(".claude/rules/"),
  ) as Array<Extract<EmitOp, { kind: "owned" }>>;
  if (claudeRuleFiles.length > 0) {
    return {
      totalLines: claudeRuleFiles.reduce((sum, op) => sum + countLines(op.content), 0),
      fileCount: claudeRuleFiles.length,
    };
  }

  const agentsBlock = ops.find(
    (op) => op.kind === "block" && (op.target === "codex" || op.target === "agents-md"),
  ) as Extract<EmitOp, { kind: "block" }> | undefined;
  if (agentsBlock) {
    const blocks = Object.values(agentsBlock.blocks);
    return {
      totalLines: blocks.reduce((sum, content) => sum + countLines(content), 0),
      fileCount: blocks.length,
    };
  }

  return { totalLines: 0, fileCount: 0 };
}

export interface ApplyResult {
  text: string;
  changed: boolean;
  /** Conflicts (user-edited managed content): block ids for block delivery,
   *  `permissions.<bucket>` / `plugins.marketplaces` / `plugins.enable` for the
   *  JSON merge; never for owned. */
  conflicts: string[];
}

/** Apply one emit op against the destination file's existing text (pure; no I/O).
 *  Owned files are replaced wholesale; block files are reconciled; settings ops
 *  reconcile permissions and/or plugins in one pass over the same JSON file. */
export function applyOp(op: EmitOp, existing = ""): ApplyResult {
  if (op.kind === "owned") {
    return { text: op.content, changed: existing !== op.content, conflicts: [] };
  }
  if (op.kind === "settings") {
    const desired: DesiredSettings = {};
    if (op.rules) desired.permissions = op.rules;
    if (op.plugins) desired.plugins = op.plugins;
    return reconcileSettings(existing, desired);
  }
  if (op.kind === "codex-config") return reconcileCodexConfig(existing, op.enabled);
  if (op.kind === "codex-marketplace") {
    throw new Error("Codex marketplace operations require their ownership sidecar and must be applied by sync.");
  }
  return reconcile(existing, op.blocks);
}
