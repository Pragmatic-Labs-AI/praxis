import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSync, UncommittedChangesError } from "../src/sync.js";
import { currentMethodology } from "../test/helpers.js";

/**
 * Conformance: `sync` refuses to overwrite uncommitted work (the last line of
 * defence behind D10's conflict-not-clobber). Praxis owns these files, so
 * rewriting them is correct — but an edit that was never committed has no copy
 * anywhere to recover from, and `sync` had no preview mode to catch it first.
 *
 * Scope is deliberately narrow, and the gaps are the point rather than an
 * oversight: only **tracked, modified** files are guarded. Untracked files are
 * not (after `praxis init` every emitted file is untracked, so guarding them
 * would refuse the ordinary init → sync flow), and gitignored files are not
 * (a repo that ignores `.claude/settings.json` would be refused on every sync).
 * For `.claude/settings.json` specifically, the ownership-marker integrity check
 * in src/merge-json.ts catches hand-edits independently of git.
 */

const MANIFEST = `
version: 1
methodology: "${currentMethodology()}"
targets: [claude-code]
packages: [karpathy-claude]
`;

const RULE = ".claude/rules/praxis-karpathy-claude.md";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** A synced repo whose emitted files are all committed — the clean baseline a
 *  consumer is in before they hand-edit something. */
function committedProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-uncommitted-"));
  dirs.push(dir);
  writeFileSync(join(dir, "praxis.yaml"), MANIFEST, "utf8");
  git(dir, "init");
  git(dir, "config", "user.email", "conformance@example.invalid");
  git(dir, "config", "user.name", "Conformance");
  runSync({ cwd: dir, write: true });
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "baseline");
  return dir;
}

describe("conformance: sync refuses to destroy uncommitted work", () => {
  it("refuses, and leaves the edit byte-identical, when a tracked target is dirty", () => {
    const dir = committedProject();
    const edited = `${readFileSync(join(dir, RULE), "utf8")}\nMy own uncommitted note.\n`;
    writeFileSync(join(dir, RULE), edited, "utf8");

    const guidance = [
      `sync overwrote a tracked file with uncommitted changes. There is no committed copy to`,
      `recover from, so this is unrecoverable data loss — the failure a consumer hit in 0.3.0.`,
      `uncommittedTrackedPaths() in src/sync.ts must run BEFORE the commit boundary and throw`,
      `UncommittedChangesError, leaving every destination untouched (same posture as a staging`,
      `failure, D61). The escape hatch is --force.`,
    ].join("\n");
    expect(() => runSync({ cwd: dir, write: true }), guidance).toThrow(UncommittedChangesError);
    expect(readFileSync(join(dir, RULE), "utf8"), guidance).toBe(edited);
  });

  it("names the offending path so the message is actionable", () => {
    const dir = committedProject();
    writeFileSync(join(dir, RULE), "clobber me", "utf8");
    const guidance = [
      `The refusal must name which files blocked the sync and how to proceed; "sync failed" alone`,
      `leaves the user guessing. See UncommittedChangesError in src/sync.ts.`,
    ].join("\n");
    let message = "";
    try {
      runSync({ cwd: dir, write: true });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message, guidance).toContain(RULE);
    expect(message, guidance).toContain("--force");
  });

  it("applies the rewrite when --force is passed (the escape hatch works)", () => {
    const dir = committedProject();
    writeFileSync(join(dir, RULE), "clobber me", "utf8");
    const guidance = [
      `--force must still overwrite: the guard is a safety net, not a lock. Thread SyncOptions.force`,
      `through runSync → applyManifest in src/sync.ts.`,
    ].join("\n");
    expect(() => runSync({ cwd: dir, write: true, force: true }), guidance).not.toThrow();
    expect(readFileSync(join(dir, RULE), "utf8"), guidance).not.toBe("clobber me");
  });

  it("does not fire on a clean tree, or on a repo with no git at all", () => {
    const clean = committedProject();
    const guidance = [
      `The guard must be invisible in normal use: a clean tree syncs, and a project that is not a`,
      `git repository at all must still sync rather than being blocked by a missing git. Both are`,
      `handled by uncommittedTrackedPaths() returning [] in src/sync.ts.`,
    ].join("\n");
    expect(() => runSync({ cwd: clean, write: true }), guidance).not.toThrow();

    const noGit = mkdtempSync(join(tmpdir(), "praxis-nogit-"));
    dirs.push(noGit);
    writeFileSync(join(noGit, "praxis.yaml"), MANIFEST, "utf8");
    expect(() => runSync({ cwd: noGit, write: true }), guidance).not.toThrow();
  });

  it("does not fire on untracked files — init then sync must not be refused", () => {
    const dir = mkdtempSync(join(tmpdir(), "praxis-untracked-"));
    dirs.push(dir);
    writeFileSync(join(dir, "praxis.yaml"), MANIFEST, "utf8");
    git(dir, "init");
    runSync({ cwd: dir, write: true }); // emits; everything is now untracked

    const guidance = [
      `Guarding untracked files would refuse the ordinary init → sync flow, where every emitted`,
      `file is untracked and there is no committed baseline to have lost. uncommittedTrackedPaths()`,
      `in src/sync.ts must skip porcelain "??" entries.`,
    ].join("\n");
    expect(() => runSync({ cwd: dir, write: true }), guidance).not.toThrow();
  });
});
