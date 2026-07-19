import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest } from "./manifest.js";

/**
 * Project-owned instructions shared by Claude Code and Codex. Unlike managed
 * methodology blocks, these blocks carry no hash and have no generated source:
 * both native files remain complete and editable if Praxis is removed.
 */

export const SHARED_PROJECT_BEGIN = "<!-- praxis:shared-project begin -->";
export const SHARED_PROJECT_END = "<!-- praxis:shared-project end -->";

const SHARED_PROJECT_RE =
  /<!--\s*praxis:shared-project\s+begin\s*-->[^\n]*\r?\n([\s\S]*?)\r?\n?<!--\s*praxis:shared-project\s+end\s*-->/g;

export type SharedInstructionStatus =
  | "not-required"
  | "pending-onboarding"
  | "missing"
  | "mismatch"
  | "synchronized";

export interface SharedInstructionReport {
  status: SharedInstructionStatus;
  ok: boolean;
  diagnostics: string[];
}

function blockContents(text: string): string[] {
  const contents: string[] = [];
  SHARED_PROJECT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SHARED_PROJECT_RE.exec(text)) !== null) {
    contents.push((match[1] ?? "").replaceAll("\r\n", "\n"));
  }
  return contents;
}

export function hasSharedProjectBlock(text: string): boolean {
  return blockContents(text).length === 1;
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/**
 * Check the peer-native project instruction contract. Only a dual first-class
 * Claude+Codex install requires parity. The onboarding sentinel temporarily
 * suspends the requirement while the agent is authoring both native surfaces.
 */
export function checkSharedInstructions(cwd: string, manifest: Manifest): SharedInstructionReport {
  if (!(manifest.targets.includes("claude-code") && manifest.targets.includes("codex"))) {
    return { status: "not-required", ok: true, diagnostics: [] };
  }

  if (existsSync(join(cwd, ".praxis-setup-pending"))) {
    return { status: "pending-onboarding", ok: true, diagnostics: [] };
  }

  const files = ["CLAUDE.md", "AGENTS.md"] as const;
  const blocks = new Map(files.map((file) => [file, blockContents(readIfExists(join(cwd, file)))]));
  const diagnostics: string[] = [];

  for (const file of files) {
    const count = blocks.get(file)?.length ?? 0;
    if (count === 0) diagnostics.push(`${file}: missing project-owned praxis:shared-project block`);
    if (count > 1) diagnostics.push(`${file}: expected one praxis:shared-project block, found ${count}`);
  }

  if (diagnostics.length > 0) return { status: "missing", ok: false, diagnostics };

  const claude = blocks.get("CLAUDE.md")?.[0] ?? "";
  const agents = blocks.get("AGENTS.md")?.[0] ?? "";
  if (claude !== agents) {
    return {
      status: "mismatch",
      ok: false,
      diagnostics: [
        "CLAUDE.md and AGENTS.md shared project blocks differ; run the Praxis upkeep workflow to reconcile project-owned facts",
      ],
    };
  }

  return { status: "synchronized", ok: true, diagnostics: [] };
}
