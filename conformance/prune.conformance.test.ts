import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../src/program.js";
import { runSync } from "../src/sync.js";

/**
 * Conformance: `sync` prune-on-removal (D46). The manifest expresses absence
 * too — a package removed from
 * `praxis.yaml` must not leave its previously emitted files/blocks stranded on
 * disk forever. No new ownership state: files are owned by the `praxis-` prefix
 * convention, blocks by their `<!-- praxis:begin <id> -->` marker. Prune is
 * (on-disk owned set) − (manifest-implied set), previewed like any other change,
 * conflict-not-clobber preserved for a user-edited block (mirrors D10).
 */

const TWO_PACKAGES = `
version: 1
methodology: "0.1.0"
targets: [claude-code]
packages: [karpathy-claude, instruction-upkeep]
`;

const ONE_PACKAGE = `
version: 1
methodology: "0.1.0"
targets: [claude-code]
packages: [karpathy-claude]
`;

const TWO_PACKAGES_AGENTS_MD = `
version: 1
methodology: "0.1.0"
targets: [agents-md]
packages: [karpathy-claude, instruction-upkeep]
`;

const ONE_PACKAGE_AGENTS_MD = `
version: 1
methodology: "0.1.0"
targets: [agents-md]
packages: [karpathy-claude]
`;

const RULE_KARPATHY = ".claude/rules/praxis-karpathy-claude.md";
const RULE_INSTRUCTION_UPKEEP = ".claude/rules/praxis-instruction-upkeep.md";
const COMMAND_INSTRUCTIONS = ".claude/commands/praxis-instructions.md";
const AGENTS = "AGENTS.md";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempProject(manifest: string): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-prune-"));
  dirs.push(dir);
  writeFileSync(join(dir, "praxis.yaml"), manifest, "utf8");
  return dir;
}

describe("conformance: sync prune-on-removal", () => {
  it("deletes an owned file/command whose package was removed from praxis.yaml; other packages' files and user content are untouched; a second sync is a no-op", () => {
    const dir = tempProject(TWO_PACKAGES);
    runSync({ cwd: dir, write: true });
    expect(existsSync(join(dir, RULE_KARPATHY))).toBe(true);
    expect(existsSync(join(dir, RULE_INSTRUCTION_UPKEEP))).toBe(true);
    expect(existsSync(join(dir, COMMAND_INSTRUCTIONS))).toBe(true);
    const keptBefore = readFileSync(join(dir, RULE_KARPATHY), "utf8");

    // Remove instruction-upkeep from the manifest — declarative absence.
    writeFileSync(join(dir, "praxis.yaml"), ONE_PACKAGE, "utf8");

    const guidance = [
      `Removing a package from praxis.yaml must orphan (and sync must delete) the`,
      `owned files it used to emit — sync never deleted before (D46), so absence`,
      `couldn't be expressed. Compute the manifest-implied "owned" op paths from`,
      `planEmit and delete any .claude/rules/praxis-*.md or`,
      `.claude/commands/praxis-*.md on disk that isn't among them. See`,
      `findOwnedOrphans/applyManifest in src/sync.ts.`,
    ].join("\n");

    const report = runSync({ cwd: dir, write: true });
    expect(existsSync(join(dir, RULE_INSTRUCTION_UPKEEP)), guidance).toBe(false);
    expect(existsSync(join(dir, COMMAND_INSTRUCTIONS)), guidance).toBe(false);
    expect(report.changed, guidance).toBe(true);

    // The still-selected package's file is untouched, byte-for-byte.
    expect(readFileSync(join(dir, RULE_KARPATHY), "utf8"), guidance).toBe(keptBefore);

    // Idempotent: a second sync is a no-op.
    const second = runSync({ cwd: dir, write: true });
    expect(second.changed, "a second sync after the deletion must be a no-op").toBe(false);
  });

  it("splices an orphan block out of AGENTS.md when its package is removed; surrounding user prose is byte-identical", () => {
    const dir = tempProject(TWO_PACKAGES_AGENTS_MD);
    const userProse = "# My project\n\nHand-written notes the user owns.\n";
    writeFileSync(join(dir, AGENTS), userProse, "utf8");
    runSync({ cwd: dir, write: true });
    expect(readFileSync(join(dir, AGENTS), "utf8")).toMatch(/praxis:begin instruction-upkeep/);

    writeFileSync(join(dir, "praxis.yaml"), ONE_PACKAGE_AGENTS_MD, "utf8");

    const guidance = [
      `Removing a package that delivers a managed block (agents-md target) must`,
      `splice that block (both markers + content) out of AGENTS.md, leaving every`,
      `other byte — including unrelated user prose and the surviving karpathy-claude`,
      `block — exactly as it was. See pruneOrphanBlocks/spliceOutBlock in`,
      `src/sync.ts; mirrors reconcile()'s block-splice discipline in src/merge.ts.`,
    ].join("\n");

    const report = runSync({ cwd: dir, write: true });
    const after = readFileSync(join(dir, AGENTS), "utf8");
    expect(after, guidance).not.toMatch(/praxis:begin instruction-upkeep/);
    expect(after, guidance).toMatch(/praxis:begin karpathy-claude/);
    expect(after.startsWith(userProse), guidance).toBe(true);
    expect(report.changed, guidance).toBe(true);

    // Idempotent: a second sync is a no-op.
    const second = runSync({ cwd: dir, write: true });
    expect(second.changed, "a second sync after the splice must be a no-op").toBe(false);
  });

  it("reports a conflict (not a deletion) for an orphan block the user edited — conflict-not-clobber (D10)", () => {
    const dir = tempProject(TWO_PACKAGES_AGENTS_MD);
    runSync({ cwd: dir, write: true });
    const before = readFileSync(join(dir, AGENTS), "utf8");
    const edited = before.replace(
      /(<!-- praxis:begin instruction-upkeep[^\n]*-->\n)([\s\S]*?)(\n<!-- praxis:end instruction-upkeep -->)/,
      "$1$2 (MY EDIT)$3",
    );
    expect(edited, "fixture setup must actually edit the block").not.toBe(before);
    writeFileSync(join(dir, AGENTS), edited, "utf8");

    writeFileSync(join(dir, "praxis.yaml"), ONE_PACKAGE_AGENTS_MD, "utf8");

    const guidance = [
      `An orphan block whose on-disk content no longer matches its recorded sha256`,
      `was user-edited — D10 forbids overwriting or deleting it. Prune must report`,
      `it as a conflict, exactly like the existing edited-block path, and leave the`,
      `bytes untouched. See pruneOrphanBlocks in src/sync.ts (blockStatus === "user-edited").`,
    ].join("\n");

    const report = runSync({ cwd: dir, write: true });
    expect(readFileSync(join(dir, AGENTS), "utf8"), guidance).toContain("(MY EDIT)");
    expect(report.hasConflicts, guidance).toBe(true);
    const conflictFile = report.files.find((f) => f.path === AGENTS);
    expect(conflictFile?.conflicts, guidance).toContain("instruction-upkeep");
  });

  it("check mode reports an orphan as drift (non-zero exit) without deleting it", async () => {
    const dir = tempProject(TWO_PACKAGES);
    runSync({ cwd: dir, write: true });
    writeFileSync(join(dir, "praxis.yaml"), ONE_PACKAGE, "utf8");

    const cwd = process.cwd();
    const exitCode = process.exitCode;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      process.exitCode = undefined;
      process.chdir(dir);

      const guidance = [
        `praxis check must treat an orphaned file/block as drift, same as any other`,
        `out-of-sync file: non-zero exit, and it must NOT delete anything (check is`,
        `dry-run). See reconcile()/runReconcile() in src/program.ts and the`,
        `write-gated deletion in applyManifest (src/sync.ts).`,
      ].join("\n");

      await buildProgram().parseAsync(["node", "praxis", "check"], { from: "node" });
      expect(process.exitCode, guidance).toBe(1);
      expect(existsSync(join(dir, RULE_INSTRUCTION_UPKEEP)), guidance).toBe(true);
      expect(existsSync(join(dir, COMMAND_INSTRUCTIONS)), guidance).toBe(true);
    } finally {
      process.chdir(cwd);
      process.exitCode = exitCode;
      log.mockRestore();
      error.mockRestore();
    }
  });
});
