import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cancel, confirm, intro, isCancel, multiselect, note, outro, select, updateSettings } from "@clack/prompts";
import { Command } from "commander";
import { checkAnchors, type AnchorCheckReport } from "./anchors.js";
import { computeMethodologySize, type MethodologySize } from "./emit.js";
import {
  applyInit,
  defaultManifest,
  detectContext,
  manifestFromSelections,
  needsSetupSentinel,
  renderManifestYaml,
} from "./init.js";
import {
  loadManifest,
  loadWorkspaceConfig,
  memberName,
  STACKS,
  TARGETS,
  type Manifest,
  type Stack,
  type Target,
  type Workspace,
} from "./manifest.js";
import { availablePackages } from "./packages.js";
import { checkSharedInstructions, type SharedInstructionReport } from "./shared-instructions.js";
import { applyManifest, runSync, type FileReport, type SyncReport } from "./sync.js";

/**
 * The CLI surface (docs/wiki/interaction-model.md). `init` is the minimal first-run
 * install (detect → propose → preview → confirm → write + apply); `sync`/`check`
 * reconcile an existing repo to its `praxis.yaml`.
 */

const STATUS_SYMBOL: Record<FileReport["status"], string> = {
  created: "+",
  updated: "~",
  unchanged: " ",
  deleted: "-",
};

type WizardMode = "quick" | "customize";
export type WizardStep = "mode" | "stacks" | "packages" | "targets" | "preview";

/** The interactive install wizard is reversible until its final apply action. */
export function previousWizardStep(step: Exclude<WizardStep, "mode">, mode: WizardMode): WizardStep {
  if (step === "stacks") return "mode";
  if (step === "packages") return "stacks";
  if (step === "targets") return mode === "quick" ? "mode" : "packages";
  return "targets";
}

function formatPlan(report: SyncReport, mode: "init" | "sync" | "check"): string {
  return report.files
    .map((f) => {
      const drift = mode === "check" && f.status !== "unchanged" ? " (drift)" : "";
      const conflict = f.conflicts.length ? `  ⚠ conflict: ${f.conflicts.join(", ")}` : "";
      return `  ${STATUS_SYMBOL[f.status]} ${f.path}${drift}${conflict}`;
    })
    .join("\n");
}

function formatAnchorReport(report: AnchorCheckReport): string {
  if (report.diagnostics.length === 0) {
    // Skip clause only when nonzero (D53): a non-workspace repo never has
    // member-anchor skips, so this line stays byte-identical to before.
    const skipNote = report.skipped.length
      ? `, ${report.skipped.length} skipped (members not cloned: ${
          [...new Set(report.skipped.map((s) => s.member))].sort().join(", ")
        })`
      : "";
    return `\nKnowledge anchors: ${report.anchorsChecked} checked (${report.filesScanned} files scanned), 0 broken${skipNote}.`;
  }

  const diagnostics = report.diagnostics
    .map((d) => {
      const target = d.target === undefined ? "" : ` (${d.type}: ${d.target})`;
      return `  - ${d.file}${target}: ${d.message}`;
    })
    .join("\n");
  return `\nBroken knowledge anchors:\n${diagnostics}`;
}

function formatSharedInstructionReport(report: SharedInstructionReport): string | undefined {
  if (report.status === "not-required") return undefined;
  if (report.status === "pending-onboarding") {
    return "\nShared project instructions: onboarding pending; parity check deferred.";
  }
  if (report.status === "synchronized") {
    return "\nShared project instructions: CLAUDE.md and AGENTS.md synchronized.";
  }
  return `\nShared project instruction drift:\n${report.diagnostics.map((d) => `  - ${d}`).join("\n")}`;
}

/** Advisory `check` report for a hub's `workspace:` section (D53). Purely
 *  informational — never affects exit code (Tier-3 posture, D45): a member not
 *  yet cloned, or not yet Praxis-onboarded, or a contract page not yet written
 *  are all bootstrap-order facts, not repo defects. */
export interface WorkspaceReport {
  totalMembers: number;
  clonedMembers: string[];
  unclonedMembers: string[];
  /** Cloned members whose own directory has a praxis.yaml (self-reported,
   *  hub-observed only — the hub never installs into a member). */
  onboardedMembers: string[];
  /** Declared edge `contract` pages that don't exist yet, hub-relative. */
  missingContracts: string[];
}

function buildWorkspaceReport(cwd: string, workspace: Workspace): WorkspaceReport {
  const clonedMembers: string[] = [];
  const unclonedMembers: string[] = [];
  const onboardedMembers: string[] = [];

  for (const member of workspace.members) {
    const name = memberName(member);
    const dir = join(cwd, member.path);
    if (existsSync(dir) && existsSync(join(dir, ".git"))) {
      clonedMembers.push(name);
      if (existsSync(join(dir, "praxis.yaml"))) onboardedMembers.push(name);
    } else {
      unclonedMembers.push(name);
    }
  }

  const missingContracts = workspace.edges
    .map((edge) => edge.contract)
    .filter((contract): contract is string => contract !== undefined && !existsSync(join(cwd, contract)));

  return {
    totalMembers: workspace.members.length,
    clonedMembers,
    unclonedMembers,
    onboardedMembers,
    missingContracts,
  };
}

function formatWorkspaceReport(report: WorkspaceReport): string {
  const unclonedNote = report.unclonedMembers.length ? ` (${report.unclonedMembers.join(", ")})` : "";
  const line =
    `\nWorkspace: ${report.totalMembers} members — ${report.clonedMembers.length} cloned, ` +
    `${report.unclonedMembers.length} not cloned${unclonedNote}; ${report.onboardedMembers.length} Praxis-onboarded.`;
  const contractsNote = report.missingContracts.length
    ? `\nWorkspace contracts not yet written: ${report.missingContracts.join(", ")}.`
    : "";
  return line + contractsNote;
}

// --- sync / check ---------------------------------------------------------

/** This CLI's own version, read from its shipped package.json (falls back to "unknown"). */
export function praxisVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
    const version = (pkg as { version?: unknown }).version;
    return typeof version === "string" ? version : "unknown";
  } catch {
    return "unknown";
  }
}

export interface ReconcileResult {
  version: string;
  syncReport?: SyncReport;
  /** Set when the manifest could not be resolved (e.g. an unknown package). */
  syncError?: string;
  /** Present only in check mode. */
  anchorReport?: AnchorCheckReport;
  /** Present only in check mode, and only when the manifest resolves (D40's
   *  degrade-by-omission model — this line is manifest-dependent, unlike the
   *  anchor tripwire). */
  methodologySize?: MethodologySize;
  /** Present in check mode when the manifest resolves. */
  sharedInstructionReport?: SharedInstructionReport;
  /** Present in check mode when a `workspace:` section is available — either
   *  from a resolved manifest, or (D40 fallback) `loadWorkspaceConfig`'s lenient
   *  read when the full manifest can't resolve. Advisory only. */
  workspaceReport?: WorkspaceReport;
  exitCode: number;
}

/**
 * Pure orchestration for `sync`/`check`, split out from console I/O so the
 * decoupling below is testable (conformance/anchors.conformance.test.ts).
 *
 * The knowledge-anchor tripwire reads markdown only — it needs nothing from the
 * manifest — so in check mode it runs even when `runSync` throws. A stale or
 * incompatible CLI (e.g. an old npx-cached build that can't resolve today's
 * `praxis.yaml`) must still report whether cited repo reality resolves, rather
 * than silently skipping the check and leaving the tripwire dark. (D40)
 */
export function reconcile(cwd: string, write: boolean, mode: "sync" | "check"): ReconcileResult {
  const version = praxisVersion();
  let syncReport: SyncReport | undefined;
  let syncError: string | undefined;
  let exitCode = 0;

  try {
    syncReport = runSync({ cwd, write });
    if (mode === "check" ? syncReport.changed || syncReport.hasConflicts : syncReport.hasConflicts) {
      exitCode = 1;
    }
  } catch (err) {
    syncError = (err as Error).message;
    exitCode = 1;
  }

  let anchorReport: AnchorCheckReport | undefined;
  let methodologySize: MethodologySize | undefined;
  let sharedInstructionReport: SharedInstructionReport | undefined;
  let workspaceReport: WorkspaceReport | undefined;
  if (mode === "check") {
    // Load the manifest once, leniently. The anchor tripwire needs workspace
    // member info (D53) to resolve `member:` anchors even when the full
    // manifest can't resolve (D40) — same lenient posture as the tripwire
    // itself — so this load happens up front and is reused below for
    // methodologySize/sharedInstructionReport rather than parsing praxis.yaml
    // a second time on the happy path.
    let manifest: Manifest | undefined;
    try {
      manifest = loadManifest(join(cwd, "praxis.yaml"));
    } catch {
      manifest = undefined;
    }
    const workspace = manifest?.workspace ?? loadWorkspaceConfig(cwd);

    anchorReport = checkAnchors(cwd, workspace);
    if (!anchorReport.ok) exitCode = 1;

    // Advisory only, never affects exit code (Tier-3 posture, D45): a member
    // not yet cloned, or a contract page not yet written, is bootstrap order,
    // not a repo defect.
    if (workspace) workspaceReport = buildWorkspaceReport(cwd, workspace);

    // Advisory only (D45): report the always-loaded
    // methodology surface size. Manifest-dependent, unlike the anchor tripwire
    // above — if it can't resolve (the D40 scenario), omit the line rather than
    // let this computation throw or mask the sync error already reported.
    if (manifest) {
      try {
        methodologySize = computeMethodologySize(manifest, cwd);
        sharedInstructionReport = checkSharedInstructions(cwd, manifest);
        if (!sharedInstructionReport.ok) exitCode = 1;
      } catch {
        // omitted — syncError (if any) already reports the unresolvable manifest.
      }
    }
  }

  return {
    version,
    syncReport,
    syncError,
    anchorReport,
    methodologySize,
    sharedInstructionReport,
    workspaceReport,
    exitCode,
  };
}

function runReconcile(write: boolean, mode: "sync" | "check"): void {
  const result = reconcile(process.cwd(), write, mode);

  // Surface the running version in check output so a stale npx-cached build is
  // visible instead of silently under-reporting (D40).
  if (mode === "check") console.log(`praxis v${result.version}`);

  if (result.syncError) {
    console.error(`praxis: ${result.syncError}`);
  } else if (result.syncReport) {
    console.log(formatPlan(result.syncReport, mode));
    if (result.syncReport.hasConflicts) {
      console.error(
        "\nConflicts: you edited Praxis-managed content. It was left untouched.\n" +
          "Resolve by promoting the change upstream or moving it outside the managed block.",
      );
    }
  }

  if (result.anchorReport) {
    const output = formatAnchorReport(result.anchorReport);
    if (result.anchorReport.ok) console.log(output);
    else console.error(output);
  }

  if (result.sharedInstructionReport) {
    const output = formatSharedInstructionReport(result.sharedInstructionReport);
    if (output) {
      if (result.sharedInstructionReport.ok) console.log(output);
      else console.error(output);
    }
  }

  if (result.methodologySize) {
    const { totalLines, fileCount } = result.methodologySize;
    console.log(`Methodology size: ${totalLines} lines across ${fileCount} always-loaded rule files.`);
  }

  if (result.workspaceReport) console.log(formatWorkspaceReport(result.workspaceReport));

  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

// --- init -----------------------------------------------------------------

async function runInit(opts: { yes?: boolean; target?: string[] }): Promise<void> {
  const cwd = process.cwd();
  intro("praxis — install the methodology layer");
  try {
    const ctx = detectContext(cwd);

    if (ctx.manifestExists) {
      note(
        "This repo already has a praxis.yaml.\nRun `praxis sync` to apply changes.",
        "Already initialized",
      );
      outro("Nothing to do.");
      return;
    }

    // Validated once and honored by both paths below: --yes uses it as the
    // manifest's targets directly, interactive mode seeds the target prompt
    // with it instead of silently discarding an explicit flag.
    const explicitTargets = opts.target?.map((target) => {
      if (!TARGETS.includes(target as Target)) {
        throw new Error(`Unknown target "${target}". Expected one of: ${TARGETS.join(", ")}.`);
      }
      return target as Target;
    });

    const detected = [
      ctx.hasGit ? "git" : null,
      ctx.hasClaudeMd ? "CLAUDE.md" : null,
      ctx.hasAgentsMd ? "AGENTS.md" : null,
      ctx.detectedTargets.length ? `targets: ${ctx.detectedTargets.join(", ")}` : null,
      ctx.detectedStacks.length ? `stack: ${ctx.detectedStacks.join(", ")}` : null,
    ].filter(Boolean);
    note(detected.length ? detected.join(" · ") : "fresh repo", "Detected");

    let manifest: Manifest | undefined;
    let previewConfirmed = false;

    if (opts.yes) {
      // Non-interactive: Quick start, no prompts
      manifest = defaultManifest(ctx, explicitTargets?.length ? explicitTargets : undefined);
    } else {
      let mode: WizardMode = "quick";
      let step: WizardStep = "mode";
      let chosenStacks = ctx.detectedStacks;
      let chosenPkgs: string[] | undefined;
      let chosenTargets: Target[] = explicitTargets?.length ? explicitTargets :
        ctx.detectedTargets.length > 0 ? ctx.detectedTargets : ["claude-code", "agents-md"];

      // Backspace mirrors Escape/Ctrl+C (clack's `cancel` action) so it works as a
      // "go back" key on the stacks/packages/targets multiselects below, where a
      // checkbox item can't reliably capture plain Enter the way `select` does.
      updateSettings({ aliases: { backspace: "cancel" } });

      while (step !== "preview" || !previewConfirmed) {
        if (step === "preview") {
          if (manifest === undefined) {
            throw new Error("Install wizard reached preview without a manifest.");
          }
          const manifestYaml = renderManifestYaml(manifest);
          const report = applyManifest(manifest, cwd, false);
          note(manifestYaml.trimEnd(), "praxis.yaml (proposed)");
          const freshHarness = needsSetupSentinel(ctx, manifest);
          const willWritePlan = formatPlan(report, "init");
          const sentinelLine = freshHarness ? "\n  + .praxis-setup-pending  (onboarding sentinel)" : "";
          note(willWritePlan + sentinelLine, "Will write");
          const next = await select<"apply" | "back" | "cancel">({
            message: "What would you like to do?",
            options: [
              { value: "apply", label: "Apply these changes" },
              { value: "back", label: "← Back to targets" },
              { value: "cancel", label: "Cancel" },
            ],
          });
          if (isCancel(next) || next === "cancel") {
            cancel("No changes made.");
            return;
          }
          if (next === "back") {
            step = previousWizardStep("preview", mode);
          } else {
            previewConfirmed = true;
          }
        } else if (step === "mode") {
          const selectedMode = await select<WizardMode>({
            message: "How do you want to install?",
            options: [
              { value: "quick", label: "Quick start", hint: "all Layer 1 + detected stack Layer 2" },
              { value: "customize", label: "Customize", hint: "pick stacks, packages, and targets" },
            ],
          });
          if (isCancel(selectedMode)) {
            cancel("No changes made.");
            return;
          }
          mode = selectedMode;
          step = mode === "quick" ? "targets" : "stacks";
        } else if (step === "stacks") {
          const selectedStacks = await multiselect<string>({
            message: "Which stacks does this repo use? (Backspace to go back)",
            options: STACKS.map((s) => ({ value: s, label: s })),
            initialValues: chosenStacks,
            required: false,
          });
          if (isCancel(selectedStacks)) {
            step = previousWizardStep("stacks", mode);
          } else {
            chosenStacks = STACKS.filter((stack) => selectedStacks.includes(stack));
            step = "packages";
          }
        } else if (step === "packages") {
          // Typed <string>, not <Stack>: see the matching comment in
          // src/init.ts's defaultManifest (D53's derived "workspace" pseudo-stack
          // widened PackageManifest["stack"]; no behavior change here).
          const stackSet = new Set<string>(chosenStacks);
          const pkgOptions: Array<{ value: string; label: string; hint?: string }> = [];
          for (const [name, pkg] of availablePackages()) {
            if (pkg.layer === "layer1" || pkg.layer === "external") {
              pkgOptions.push({ value: name, label: name, hint: pkg.layer });
            } else if (pkg.layer === "layer2" && pkg.stack && stackSet.has(pkg.stack)) {
              pkgOptions.push({ value: name, label: name, hint: `layer2 / ${pkg.stack}` });
            }
          }
          pkgOptions.sort((a, b) => a.value.localeCompare(b.value));
          const recommended = new Set(defaultManifest({ ...ctx, detectedStacks: chosenStacks }).packages);
          const selectedPkgs = await multiselect<string>({
            message: "Which packages? (Backspace to go back)",
            options: pkgOptions,
            initialValues: chosenPkgs ?? pkgOptions.map((o) => o.value).filter((name) => recommended.has(name)),
            required: true,
          });
          if (isCancel(selectedPkgs)) {
            step = previousWizardStep("packages", mode);
          } else {
            chosenPkgs = selectedPkgs;
            step = "targets";
          }
        } else {
          const selectedTargets = await multiselect<string>({
            message: "Which targets should Praxis support? (Backspace to go back)",
            options: TARGETS.map((target) => ({ value: target, label: target })),
            initialValues: chosenTargets,
            required: true,
          });
          if (isCancel(selectedTargets)) {
            step = previousWizardStep("targets", mode);
          } else {
            chosenTargets = TARGETS.filter((target) => selectedTargets.includes(target));
            const baseManifest = mode === "quick"
              ? defaultManifest(ctx)
              : manifestFromSelections(chosenStacks, chosenPkgs ?? [], defaultManifest(ctx).targets);
            manifest = { ...baseManifest, targets: chosenTargets };

            // Workspace hub detection (D53 WS4): a dedicated confirm(), not a new
            // WizardStep — gated on >=2 nested git repos to avoid a false positive
            // on a single vendored/cloned directory. Declines (including Escape/
            // Ctrl+C — a confirm() has no "back" target of its own to unwind to)
            // simply leave the manifest as built above and fall through to preview,
            // same as answering "no".
            if (ctx.detectedMembers.length >= 2) {
              const memberList = ctx.detectedMembers.join(", ");
              const setUpWorkspace = await confirm({
                message:
                  `Detected ${ctx.detectedMembers.length} nested git repos (${memberList}). ` +
                  "Set this repo up as a Praxis workspace hub?",
              });
              if (!isCancel(setUpWorkspace) && setUpWorkspace) {
                const workspace: Workspace = {
                  members: ctx.detectedMembers.map((path) => ({ path })),
                  edges: [],
                };
                // Union in the workspace package + its requires (D21) — the user may
                // have deselected one of them via Customize; the workspace gate
                // requires all of them present.
                const workspacePkg = availablePackages().get("workspace");
                const packages = new Set(manifest.packages);
                packages.add("workspace");
                for (const req of workspacePkg?.requires ?? []) packages.add(req);
                manifest = { ...manifest, workspace, packages: [...packages] };
              }
            }

            step = "preview";
          }
        }
      }

      if (manifest === undefined) {
        throw new Error("Install wizard ended without a manifest.");
      }
    }

    const freshHarness = needsSetupSentinel(ctx, manifest);
    if (!previewConfirmed) {
      const manifestYaml = renderManifestYaml(manifest);
      const report = applyManifest(manifest, cwd, false);
      note(manifestYaml.trimEnd(), "praxis.yaml (proposed)");
      const willWritePlan = formatPlan(report, "init");
      const sentinelLine = freshHarness ? "\n  + .praxis-setup-pending  (onboarding sentinel)" : "";
      note(willWritePlan + sentinelLine, "Will write");
    }

    applyInit(cwd, manifest, ctx);

    const installedWorkflows = [
      manifest.targets.includes("claude-code")
        ? "/praxis-instructions  /praxis-wiki  /praxis-handoff\n  /praxis-upkeep  /praxis-onboard"
        : null,
      manifest.targets.includes("codex")
        ? "$praxis-instructions  $praxis-wiki  $praxis-handoff\n  $praxis-upkeep  $praxis-onboard"
        : null,
    ].filter((line): line is string => line !== null).join("\n  ");

    if (freshHarness) {
      note(
        [
          "Open one of the selected coding agents in this repo.",
          "It will offer the Praxis onboarding workflow (one-shot bootstrap).",
          "",
          "Installed skills:",
          `  ${installedWorkflows}`,
          "",
          "Run `praxis check` anytime to verify the repo is in sync (good for CI).",
        ].join("\n"),
        "Next steps",
      );
      outro("Methodology layer installed. Open a selected agent to complete onboarding.");
    } else {
      note(
        [
          "Existing project instruction surfaces were preserved.",
          "",
          "Installed skills:",
          `  ${installedWorkflows}`,
          "",
          "To tune: edit `praxis.yaml`, then run `praxis sync`.",
          "Run `praxis check` anytime to verify the repo is in sync (good for CI).",
        ].join("\n"),
        "Next steps",
      );
      outro("Methodology layer installed.");
    }
  } catch (err) {
    cancel(`praxis: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("praxis")
    .description("Install and sync an AI methodology layer into a codebase.")
    .version(praxisVersion());

  program
    .command("init", { isDefault: true })
    .description("Install the methodology layer (detect, preview, confirm, write).")
    .option("-y, --yes", "skip prompts; accept the defaults (non-interactive)")
    .option("--target <target>", "emit target; repeat for multiple targets", (value, previous: string[]) => [
      ...previous,
      value,
    ], [])
    .action((opts: { yes?: boolean; target?: string[] }) => runInit(opts));

  program
    .command("sync")
    .description("Reconcile the repo to praxis.yaml; write managed methodology files.")
    .action(() => runReconcile(true, "sync"));

  program
    .command("check")
    .description("Report drift without writing; non-zero exit on drift.")
    .action(() => runReconcile(false, "check"));

  return program;
}
