import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../src/program.js";
import { runSync } from "../src/sync.js";
import { currentMethodology } from "../test/helpers.js";

/**
 * Conformance: the sync/check orchestration upholds the interaction-model / merge-engine contract
 * end-to-end (on the filesystem): idempotent re-sync, conflict-not-clobber (D10),
 * check is strictly read-only, and check hard-fails on drift/broken anchors for
 * the D26 PR gate.
 */

const MANIFEST = `
version: 1
methodology: "${currentMethodology()}"
stacks: [python-backend]
targets: [claude-code, agents-md]
packages: [karpathy-claude]
`;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-conf-"));
  dirs.push(dir);
  writeFileSync(join(dir, "praxis.yaml"), MANIFEST, "utf8");
  return dir;
}

const AGENTS = "AGENTS.md";
const RULE = ".claude/rules/praxis-karpathy-claude.md";

describe("conformance: sync orchestration", () => {
  it("sync then check is a no-op — the repo lands in sync (idempotent end-to-end)", () => {
    const dir = tempProject();
    runSync({ cwd: dir, write: true });
    const before = [readFileSync(join(dir, AGENTS), "utf8"), readFileSync(join(dir, RULE), "utf8")];

    const guidance = [
      `After a sync, check still reports drift — the repo never converges.`,
      `runSync(write:true) then runSync(write:false) must report changed=false, and a second`,
      `write-sync must not alter the files. This is the self-hosting guarantee (`,
      `docs/wiki/merge-engine.md / docs/wiki/self-hosting.md). Check applyOp idempotency and the FileStatus logic in src/sync.ts.`,
    ].join("\n");
    const check = runSync({ cwd: dir, write: false });
    expect(check.changed, guidance).toBe(false);

    runSync({ cwd: dir, write: true });
    const after = [readFileSync(join(dir, AGENTS), "utf8"), readFileSync(join(dir, RULE), "utf8")];
    expect(after, guidance).toEqual(before);
  });

  it("never clobbers a user edit inside a managed block (D10), end-to-end", () => {
    const dir = tempProject();
    runSync({ cwd: dir, write: true });
    const path = join(dir, AGENTS);
    writeFileSync(path, readFileSync(path, "utf8").replace("Simplicity first", "Simplicity first (MY EDIT)"), "utf8");

    const guidance = [
      `sync overwrote a user edit inside a managed block — D10 forbids this.`,
      `When on-disk managed content no longer matches its recorded hash, runSync must report`,
      `a conflict and leave the file's bytes untouched. Check that runSync writes only safe`,
      `changes and surfaces conflicts (src/sync.ts), backed by reconcile() in src/merge.ts.`,
    ].join("\n");
    const report = runSync({ cwd: dir, write: true });
    expect(readFileSync(path, "utf8"), guidance).toContain("(MY EDIT)");
    expect(report.hasConflicts, guidance).toBe(true);
  });

  it("check never writes to disk", () => {
    const dir = tempProject();
    const guidance = [
      `check wrote to disk. check is a dry-run drift report and must never create or modify`,
      `files — CI runs it on every push. Guard all writes behind opts.write in src/sync.ts.`,
    ].join("\n");
    runSync({ cwd: dir, write: false });
    expect(existsSync(join(dir, AGENTS)), guidance).toBe(false);
    expect(existsSync(join(dir, ".claude")), guidance).toBe(false);
  });

  it("check hard-fails on derived harness drift — the Tier-1 PR gate", async () => {
    const dir = tempProject();
    const cwd = process.cwd();
    const exitCode = process.exitCode;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      process.exitCode = undefined;
      process.chdir(dir);

      const guidance = [
        `praxis check reported drift but did not fail the process. D26 makes Tier 1`,
        `the PR-time hard gate for derived harness drift: if emitted methodology`,
        `differs from praxis.yaml + packages, CI must fail and tell the user to run`,
        `praxis sync. Check runReconcile() in src/program.ts and the CI selfcheck step.`,
      ].join("\n");

      await buildProgram().parseAsync(["node", "praxis", "check"], { from: "node" });
      expect(process.exitCode, guidance).toBe(1);
      expect(existsSync(join(dir, AGENTS)), guidance).toBe(false);
    } finally {
      process.chdir(cwd);
      process.exitCode = exitCode;
      log.mockRestore();
      error.mockRestore();
    }
  });

  it("check hard-fails on broken knowledge anchors — the Tier-2 PR gate", async () => {
    const dir = tempProject();
    runSync({ cwd: dir, write: true });
    mkdirSync(join(dir, "docs/wiki"), { recursive: true });
    writeFileSync(
      join(dir, "docs/wiki/index.md"),
      `---
praxisAnchors:
  - type: path
    target: src/nope.ts
---
# Index
`,
      "utf8",
    );

    const cwd = process.cwd();
    const exitCode = process.exitCode;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      process.exitCode = undefined;
      process.chdir(dir);

      const guidance = [
        `praxis check did not fail on a broken knowledge anchor. D26 Tier 2 is a`,
        `deterministic hard gate: if a praxisAnchors entry points at a command, path,`,
        `or section that no longer resolves, CI must fail and name the broken anchor.`,
        `Check src/anchors.ts and the check wiring in src/program.ts.`,
      ].join("\n");

      await buildProgram().parseAsync(["node", "praxis", "check"], { from: "node" });
      expect(process.exitCode, guidance).toBe(1);
      expect(existsSync(join(dir, "src/nope.ts")), guidance).toBe(false);
    } finally {
      process.chdir(cwd);
      process.exitCode = exitCode;
      log.mockRestore();
      error.mockRestore();
    }
  });
});
