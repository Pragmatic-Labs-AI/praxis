import { createHash } from "node:crypto";
import type { Capability, Policy } from "./permissions.js";

const BLOCK_ID = "safe-permissions";
const BEGIN = /^# praxis:begin safe-permissions sha256=([a-f0-9]{64})$/m;
const END = /^# praxis:end safe-permissions$/m;

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export const CODEX_CONFIG_BODY = `default_permissions = "praxis-safe-permissions"

[permissions.praxis-safe-permissions]
description = "Workspace editing with Praxis secret-file protections and no sandbox network access."
extends = ":workspace"

[permissions.praxis-safe-permissions.filesystem]
glob_scan_max_depth = 12

[permissions.praxis-safe-permissions.filesystem.":workspace_roots"]
".env" = "deny"
"**/.env*" = "deny"
"**/*.pem" = "deny"
"**/credentials*" = "deny"

[permissions.praxis-safe-permissions.network]
enabled = false`;

function managedBlock(body: string): string {
  return `# praxis:begin ${BLOCK_ID} sha256=${hash(body)}\n${body}\n# praxis:end ${BLOCK_ID}`;
}

interface LocatedBlock {
  start: number;
  end: number;
  body: string;
  recordedHash: string;
}

function locate(text: string): LocatedBlock | undefined {
  const begin = BEGIN.exec(text);
  if (!begin || begin.index === undefined) return undefined;
  END.lastIndex = 0;
  const afterBegin = begin.index + begin[0].length;
  const end = END.exec(text.slice(afterBegin));
  if (!end || end.index === undefined) return undefined;
  const bodyStart = afterBegin + 1;
  const endStart = afterBegin + end.index;
  return {
    start: begin.index,
    end: endStart + end[0].length,
    body: text.slice(bodyStart, endStart).replace(/\n$/, ""),
    recordedHash: begin[1]!,
  };
}

function withoutBlock(text: string, block: LocatedBlock | undefined): string {
  if (!block) return text;
  return `${text.slice(0, block.start)}${text.slice(block.end)}`;
}

function externalConflicts(text: string): string[] {
  const conflicts: string[] = [];
  if (/^\s*default_permissions\s*=/m.test(text)) conflicts.push("default_permissions");
  if (/^\s*sandbox_mode\s*=/m.test(text)) conflicts.push("sandbox_mode");
  if (/^\s*\[sandbox_workspace_write\]/m.test(text)) conflicts.push("sandbox_workspace_write");
  if (/^\s*\[permissions\.praxis-safe-permissions(?:\.|\])/m.test(text)) {
    conflicts.push("permissions.praxis-safe-permissions");
  }
  return conflicts;
}

export function reconcileCodexConfig(
  existing: string,
  enabled: boolean,
): { text: string; changed: boolean; conflicts: string[] } {
  const block = locate(existing);
  if (block && hash(block.body) !== block.recordedHash) {
    return { text: existing, changed: false, conflicts: [BLOCK_ID] };
  }

  const outside = withoutBlock(existing, block);
  if (enabled) {
    const conflicts = externalConflicts(outside);
    if (conflicts.length > 0) return { text: existing, changed: false, conflicts };
    const rest = outside.trim();
    // Inserted first, not appended: a bare `key = value` line in TOML belongs
    // to whatever `[table]` precedes it, so placing our block after user
    // content risks default_permissions being silently absorbed into a table
    // the user's file happens to end inside. Leading in the file guarantees
    // root-table scope regardless of what follows.
    const text = `${managedBlock(CODEX_CONFIG_BODY)}\n${rest ? `\n${rest}\n` : ""}`;
    return { text, changed: text !== existing, conflicts: [] };
  }

  if (!block) return { text: existing, changed: false, conflicts: [] };
  const rest = outside.trim();
  const text = rest ? `${rest}\n` : "";
  return { text, changed: text !== existing, conflicts: [] };
}

type RuleDecision = "allow" | "prompt" | "forbidden";

const COMMAND_PATTERNS: Partial<Record<Capability, string[][]>> = {
  "run-dev-scripts": [
    ["npm", "run", "test"],
    ["npm", "run", "lint"],
    ["npm", "run", "typecheck"],
    ["npm", "run", "build"],
  ],
  "read-only-git": [["git", "status"], ["git", "diff"], ["git", "log"]],
  "git-commit": [["git", "commit"]],
  "git-push": [["git", "push"]],
  "install-deps": [["npm", "install"], ["npm", "i"], ["npm", "ci"]],
  "destructive-delete": [["rm", "-rf"]],
  "force-push": [["git", "push", "--force"], ["git", "push", "-f"]],
  "global-install": [
    ["npm", "install", "-g"],
    ["npm", "install", "--global"],
    ["npm", "i", "-g"],
    ["npm", "i", "--global"],
    ["pnpm", "add", "-g"],
    ["pnpm", "add", "--global"],
  ],
};

const PROFILE_CAPABILITIES = new Set<Capability>(["read-repo", "edit-repo", "read-secrets"]);

/** Every neutral capability is handled by command rules or explicitly delegated
 * to the permission profile. Exported as the Codex conformance seam. */
export function codexCapabilityMode(capability: Capability): "profile" | "rules" | undefined {
  if (PROFILE_CAPABILITIES.has(capability)) return "profile";
  if (COMMAND_PATTERNS[capability]) return "rules";
  return undefined;
}

function starlarkString(value: string): string {
  return JSON.stringify(value);
}

export function renderCodexRules(policy: Policy): string {
  const decisions: Array<[keyof Policy, RuleDecision]> = [
    ["allow", "allow"],
    ["ask", "prompt"],
    ["deny", "forbidden"],
  ];
  const lines = [
    "# Generated by Praxis. Project rules load only after this repository is trusted.",
    "# Filesystem capabilities are enforced by the praxis-safe-permissions profile in ../config.toml.",
    "",
  ];
  for (const [bucket, decision] of decisions) {
    for (const capability of policy[bucket]) {
      for (const pattern of COMMAND_PATTERNS[capability] ?? []) {
        lines.push(
          `prefix_rule(pattern = [${pattern.map(starlarkString).join(", ")}], decision = ${starlarkString(decision)}, justification = ${starlarkString(`Praxis capability: ${capability}`)})`,
        );
      }
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
