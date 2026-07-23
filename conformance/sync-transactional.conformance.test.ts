import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../src/manifest.js";
import { applyManifest } from "../src/sync.js";
import { currentMethodology } from "../test/helpers.js";

/**
 * Conformance: recoverable/transactional `sync` (D61, docs/wiki/decisions.md).
 * `applyManifest` now runs a single plan → stage → verify → commit pipeline
 * spanning all five passes (main op loop, block-orphan sweep, codex-config
 * reconcile, marketplace prune, owned-file orphans — D46), rather than
 * writing/deleting as each pass goes. Mirrors `conformance/sync.conformance.test.ts`
 * (end-to-end, real filesystem) and `conformance/prune.conformance.test.ts`
 * (prune-specific fixtures); this file injects real fs failures mid-plan,
 * which neither of those files does.
 *
 * `vi.spyOn(fs, ...)` cannot intercept `src/sync.ts`'s own named imports of
 * `node:fs` — Node's builtin ESM named exports are not configurable, so a
 * property spy on a separately-imported `fs` object is invisible to code that
 * imported the same functions by name (verified directly against this
 * runtime). `vi.mock("node:fs", ...)` with a `vi.hoisted` failure switch is
 * the mechanism that actually reaches every importer of the module.
 */
type WriteFileSync = typeof import("node:fs").writeFileSync;
type UnlinkSync = typeof import("node:fs").unlinkSync;

const fsFail = vi.hoisted(() => ({
  // 1-indexed call number (reset alongside this) at which writeFileSync /
  // unlinkSync should throw; every other call passes through to the real fn.
  writeFailOnCall: undefined as number | undefined,
  writeCallCount: 0,
  unlinkFailOnCall: undefined as number | undefined,
  unlinkCallCount: 0,
  // 1-indexed writeFileSync call at which the REAL write should land on disk
  // (unlike writeFailOnCall above, which throws before the real write ever
  // runs) and only THEN throw — simulating a write that partially/fully
  // completes before erroring (e.g. a late fsync failure).
  writeThrowAfterRealWriteOnCall: undefined as number | undefined,
  // When set, the next writeFileSync call whose path is a
  // `.praxis-tmp-<destBasename>-*` staging temp also writes `content` to the
  // real destination path first — simulating another process concurrently
  // creating a file sync's plan pass saw as absent.
  concurrentCreateDestBasename: undefined as string | undefined,
  concurrentCreateContent: "",
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const writeFileSync: WriteFileSync = (...args) => {
    const path = String(args[0]);

    if (fsFail.concurrentCreateDestBasename !== undefined) {
      const marker = `.praxis-tmp-${fsFail.concurrentCreateDestBasename}-`;
      if (basename(path).startsWith(marker)) {
        const destPath = join(dirname(path), fsFail.concurrentCreateDestBasename);
        actual.writeFileSync(destPath, fsFail.concurrentCreateContent, "utf8");
        fsFail.concurrentCreateDestBasename = undefined; // simulate it happening exactly once
      }
    }

    if (fsFail.writeThrowAfterRealWriteOnCall !== undefined) {
      fsFail.writeCallCount += 1;
      if (fsFail.writeCallCount === fsFail.writeThrowAfterRealWriteOnCall) {
        actual.writeFileSync(...args);
        throw new Error(`injected failure AFTER the real write on writeFileSync call #${fsFail.writeCallCount}`);
      }
      return actual.writeFileSync(...args);
    }

    if (fsFail.writeFailOnCall !== undefined) {
      fsFail.writeCallCount += 1;
      if (fsFail.writeCallCount === fsFail.writeFailOnCall) {
        throw new Error(`injected failure on writeFileSync call #${fsFail.writeCallCount}`);
      }
    }
    return actual.writeFileSync(...args);
  };
  const unlinkSync: UnlinkSync = (...args) => {
    if (fsFail.unlinkFailOnCall !== undefined) {
      fsFail.unlinkCallCount += 1;
      if (fsFail.unlinkCallCount === fsFail.unlinkFailOnCall) {
        throw new Error(`injected failure on unlinkSync call #${fsFail.unlinkCallCount}`);
      }
    }
    return actual.unlinkSync(...args);
  };
  return {
    ...actual,
    writeFileSync,
    unlinkSync,
    default: { ...(actual as unknown as { default: typeof actual }).default, writeFileSync, unlinkSync },
  };
});

const dirs: string[] = [];
afterEach(() => {
  fsFail.writeFailOnCall = undefined;
  fsFail.writeCallCount = 0;
  fsFail.unlinkFailOnCall = undefined;
  fsFail.unlinkCallCount = 0;
  fsFail.writeThrowAfterRealWriteOnCall = undefined;
  fsFail.concurrentCreateDestBasename = undefined;
  fsFail.concurrentCreateContent = "";
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-sync-tx-"));
  dirs.push(dir);
  return dir;
}

/** No `.praxis-tmp-*` staging artifact left anywhere under `dir` — cleaned up
 *  in `commitMutations`'s `finally` even when the run throws. */
function assertNoLeftoverTempFiles(dir: string): void {
  const stray: string[] = [];
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const entryAbs = join(abs, entry.name);
      if (entry.isDirectory()) walk(entryAbs);
      else if (entry.name.startsWith(".praxis-tmp-")) stray.push(entryAbs);
    }
  };
  walk(dir);
  expect(stray, `leftover staging temp file(s) after sync: ${stray.join(", ")}`).toEqual([]);
}

const RULE_KARPATHY = ".claude/rules/praxis-karpathy-claude.md";
const RULE_INSTRUCTION_UPKEEP = ".claude/rules/praxis-instruction-upkeep.md";
const COMMAND_INSTRUCTIONS = ".claude/commands/praxis-instructions.md";
const AGENTS = "AGENTS.md";

const TWO_PACKAGES: Manifest = {
  version: 1,
  methodology: currentMethodology(),
  targets: ["claude-code", "agents-md"],
  packages: ["karpathy-claude", "instruction-upkeep"],
};
const ONE_PACKAGE: Manifest = { ...TWO_PACKAGES, packages: ["karpathy-claude"] };

describe("conformance: recoverable/transactional sync (D61)", () => {
  it("case 1 — a failure during staging leaves every destination absent, no partial writes, no temp leaks", () => {
    const dir = tempProject();

    // A first-ever sync of two packages across two targets plans at least
    // four writes (two owned rule files, a command file, the AGENTS.md
    // block) in the same run — nothing exists on disk yet. Failing on the
    // *second* staged write is the discriminating case: a pass-by-pass
    // write-as-you-go implementation would already have committed the first
    // one for real before the second one fails; the plan/stage/verify/commit
    // pipeline stages every write before committing any of them, so nothing
    // lands at all.
    fsFail.writeFailOnCall = 2;

    const guidance = [
      `A failure while staging a temp file must abort the whole sync before any`,
      `destination is touched — the plan/stage/verify/commit pipeline in`,
      `src/sync.ts (commitMutations) exists precisely so a mid-plan crash is a`,
      `no-op, not a partial write, even when an earlier write in the same run`,
      `already staged successfully. See docs/wiki/decisions.md D61.`,
    ].join("\n");

    expect(() => applyManifest(TWO_PACKAGES, dir, true), guidance).toThrow();
    fsFail.writeFailOnCall = undefined;

    expect(existsSync(join(dir, RULE_KARPATHY)), guidance).toBe(false);
    expect(existsSync(join(dir, RULE_INSTRUCTION_UPKEEP)), guidance).toBe(false);
    expect(existsSync(join(dir, COMMAND_INSTRUCTIONS)), guidance).toBe(false);
    expect(existsSync(join(dir, AGENTS)), guidance).toBe(false);
    assertNoLeftoverTempFiles(dir);

    // A clean retry (no injected failure) must still land the full sync.
    const retry = applyManifest(TWO_PACKAGES, dir, true);
    expect(retry.hasConflicts, guidance).toBe(false);
    expect(existsSync(join(dir, AGENTS)), guidance).toBe(true);
  });

  it("case 2 — a failure during commit converges on a second sync; a third check reports changed:false", () => {
    const dir = tempProject();
    applyManifest(TWO_PACKAGES, dir, true);

    // Removing instruction-upkeep plans one write (the AGENTS.md block
    // splice) and two deletes (the owned rule + command file). Every write
    // stages and verifies cleanly this time; the injected failure hits the
    // *second* commit-phase unlink — after the rename and the first delete
    // already landed. Increment one does not roll that back: it converges
    // on retry (the increment-one/two boundary this case documents).
    fsFail.unlinkFailOnCall = 2;

    expect(() => applyManifest(ONE_PACKAGE, dir, true)).toThrow();
    fsFail.unlinkFailOnCall = undefined;

    const partialGuidance = [
      `Increment one (D61) does not guarantee plan-wide atomicity *across* the`,
      `commit-phase renames/unlinks themselves — only that a failure before`,
      `commit begins is a no-op. A failure mid-commit may leave some`,
      `destinations already at their new bytes and others still old; the`,
      `stronger increment (journal + rollback) is what would upgrade this to`,
      `"fully rolled back automatically" — see docs/wiki/decisions.md D61.`,
    ].join("\n");
    expect(readFileSync(join(dir, AGENTS), "utf8"), partialGuidance).not.toMatch(/praxis:begin instruction-upkeep/);
    expect(existsSync(join(dir, RULE_INSTRUCTION_UPKEEP)), partialGuidance).toBe(false);
    expect(existsSync(join(dir, COMMAND_INSTRUCTIONS)), partialGuidance).toBe(true);

    const convergeGuidance = [
      `Recovery from a mid-commit failure is "re-run sync": a second write-sync`,
      `must finish landing every remaining mutation, and a third check-mode run`,
      `must then report changed:false. If this fails, applyManifest's commit`,
      `boundary isn't converging cleanly on retry (src/sync.ts commitMutations).`,
    ].join("\n");
    const second = applyManifest(ONE_PACKAGE, dir, true);
    expect(second.hasConflicts, convergeGuidance).toBe(false);
    expect(existsSync(join(dir, COMMAND_INSTRUCTIONS)), convergeGuidance).toBe(false);

    const third = applyManifest(ONE_PACKAGE, dir, false);
    expect(third.changed, convergeGuidance).toBe(false);
    assertNoLeftoverTempFiles(dir);
  });

  it("case 3 — D10 guard: a user-edited block still conflicts and stays untouched despite an injected failure elsewhere", () => {
    const dir = tempProject();
    applyManifest(TWO_PACKAGES, dir, true);
    const path = join(dir, AGENTS);
    const before = readFileSync(path, "utf8");
    const edited = before.replace(
      /(<!-- praxis:begin instruction-upkeep[^\n]*-->\n)([\s\S]*?)(\n<!-- praxis:end instruction-upkeep -->)/,
      "$1$2 (MY EDIT)$3",
    );
    expect(edited, "fixture setup must actually edit the block").not.toBe(before);
    writeFileSync(path, edited, "utf8");

    // Removing instruction-upkeep now plans zero writes for AGENTS.md (the
    // orphan block is user-edited, so pruneOrphanBlocks reports a conflict
    // instead of splicing it — no mutation is queued for that file at all) and
    // two deletes elsewhere. Inject the failure into the first of those
    // unrelated deletes.
    fsFail.unlinkFailOnCall = 1;

    expect(() => applyManifest(ONE_PACKAGE, dir, true)).toThrow();
    fsFail.unlinkFailOnCall = undefined;

    const untouchedGuidance = [
      `An injected failure elsewhere in the plan must not disturb a`,
      `conflicted (user-edited) block — D10 conflict-not-clobber holds`,
      `independently of the transactional commit boundary because no mutation`,
      `is ever queued for a conflicted file (src/sync.ts pruneOrphanBlocks).`,
    ].join("\n");
    expect(readFileSync(path, "utf8"), untouchedGuidance).toContain("(MY EDIT)");
    expect(existsSync(join(dir, RULE_INSTRUCTION_UPKEEP)), untouchedGuidance).toBe(true);
    expect(existsSync(join(dir, COMMAND_INSTRUCTIONS)), untouchedGuidance).toBe(true);

    const conflictGuidance = [
      `Re-running without the injected failure must still report the`,
      `user-edited block as a conflict (never silently dropped or clobbered)`,
      `while the unrelated deletes proceed normally.`,
    ].join("\n");
    const report = applyManifest(ONE_PACKAGE, dir, true);
    expect(report.hasConflicts, conflictGuidance).toBe(true);
    expect(report.files.find((f) => f.path === AGENTS)?.conflicts, conflictGuidance).toContain("instruction-upkeep");
    expect(readFileSync(path, "utf8"), conflictGuidance).toContain("(MY EDIT)");
    expect(existsSync(join(dir, RULE_INSTRUCTION_UPKEEP)), conflictGuidance).toBe(false);
    expect(existsSync(join(dir, COMMAND_INSTRUCTIONS)), conflictGuidance).toBe(false);
    assertNoLeftoverTempFiles(dir);
  });

  it("case 4 — prune participates: a delete rides the same all-or-nothing staging boundary as a write, and converges the same way on retry", () => {
    const dir = tempProject();
    applyManifest(TWO_PACKAGES, dir, true);
    const karpathyBefore = readFileSync(join(dir, RULE_KARPATHY), "utf8");

    // Same one-write/two-delete plan as case 2 (removing instruction-upkeep),
    // but the injected failure is on the write's *staging* step this time —
    // proving the two deletes queued in the very same plan don't execute
    // independently/early: commit for the whole plan (writes and deletes
    // alike) only begins once every write has staged and verified.
    fsFail.writeFailOnCall = 1;

    const guidance = [
      `Deletes fold into the same plan/commit pipeline as writes (D46 + D61):`,
      `a staging failure on the plan's write must leave its deletes un-applied`,
      `too, not "whichever pass got there first". See commitMutations and the`,
      `single mutations list built across all five passes in src/sync.ts.`,
    ].join("\n");
    expect(() => applyManifest(ONE_PACKAGE, dir, true), guidance).toThrow();
    fsFail.writeFailOnCall = undefined;

    expect(readFileSync(join(dir, AGENTS), "utf8"), guidance).toMatch(/praxis:begin instruction-upkeep/);
    expect(existsSync(join(dir, RULE_INSTRUCTION_UPKEEP)), guidance).toBe(true);
    expect(existsSync(join(dir, COMMAND_INSTRUCTIONS)), guidance).toBe(true);
    expect(readFileSync(join(dir, RULE_KARPATHY), "utf8"), guidance).toBe(karpathyBefore);
    assertNoLeftoverTempFiles(dir);

    const convergeGuidance = [
      `A second sync (no injected failure) must finish both the AGENTS.md`,
      `splice and the two deletes, and a third check-mode run must report`,
      `changed:false — the same converges-on-retry guarantee as case 2.`,
    ].join("\n");
    const second = applyManifest(ONE_PACKAGE, dir, true);
    expect(second.changed, convergeGuidance).toBe(true);
    expect(readFileSync(join(dir, AGENTS), "utf8"), convergeGuidance).not.toMatch(/praxis:begin instruction-upkeep/);
    expect(existsSync(join(dir, RULE_INSTRUCTION_UPKEEP)), convergeGuidance).toBe(false);
    expect(existsSync(join(dir, COMMAND_INSTRUCTIONS)), convergeGuidance).toBe(false);

    const third = applyManifest(ONE_PACKAGE, dir, false);
    expect(third.changed, convergeGuidance).toBe(false);
    assertNoLeftoverTempFiles(dir);
  });

  it("case 5 — a failure during the REAL staging write leaves no leaked destination directory, not just no leaked temp file", () => {
    const dir = tempProject();

    // First-ever sync of a fresh repo: `.claude` doesn't exist yet. The first
    // real write (mutation #1) succeeds; the second fails. Under the pre-fix
    // implementation, mkdirSync(dirname(dest)) ran unconditionally during
    // STAGE, so mutation #1's real write already created `.claude/rules` for
    // real before mutation #2's injected failure aborted the run — leaking an
    // empty (but real) directory even though every destination *file* was
    // correctly left absent.
    fsFail.writeFailOnCall = 2;

    const guidance = [
      `mkdirSync(dirname(dest)) must run in the COMMIT phase, immediately`,
      `before that mutation's renameSync — never during STAGE — so a`,
      `pre-commit abort creates zero destination directories, not just zero`,
      `destination files (src/sync.ts commitMutations / tempPathFor).`,
    ].join("\n");

    expect(() => applyManifest(TWO_PACKAGES, dir, true), guidance).toThrow();
    fsFail.writeFailOnCall = undefined;

    expect(existsSync(join(dir, ".claude")), guidance).toBe(false);
    expect(existsSync(join(dir, RULE_KARPATHY)), guidance).toBe(false);
    assertNoLeftoverTempFiles(dir);

    // A clean retry must still land the full sync afterward.
    const retry = applyManifest(TWO_PACKAGES, dir, true);
    expect(retry.hasConflicts, guidance).toBe(false);
    expect(existsSync(join(dir, RULE_KARPATHY)), guidance).toBe(true);
  });

  it("case 6 — a write that throws AFTER its real bytes already landed on disk still gets its temp cleaned up", () => {
    const dir = tempProject();

    // Unlike cases 1/4/5 above (which throw *before* the real write ever
    // runs), this injects the failure *after* `actual.writeFileSync` already
    // put bytes on disk — e.g. a late fsync error. The temp path must be
    // tracked for cleanup before writeFileSync is even attempted; if it's
    // tracked only after a successful return (the pre-fix ordering), this
    // exact scenario leaks an untracked `.praxis-tmp-*` file.
    fsFail.writeThrowAfterRealWriteOnCall = 1;

    const guidance = [
      `The temp path must be pushed onto the cleanup-tracked staged list`,
      `BEFORE writeFileSync is called, not after it returns — otherwise a`,
      `write that throws after its bytes already landed on disk leaks an`,
      `untracked .praxis-tmp-* file the finally cleanup never sees`,
      `(src/sync.ts commitMutations).`,
    ].join("\n");

    expect(() => applyManifest(ONE_PACKAGE, dir, true), guidance).toThrow();
    fsFail.writeThrowAfterRealWriteOnCall = undefined;

    assertNoLeftoverTempFiles(dir);
  });
});

describe("conformance: external-change detection covers a previously-absent destination (D61 increment two)", () => {
  it("a destination created on disk between plan and commit is surfaced as external-change, not clobbered", () => {
    const dir = tempProject();
    const EXTERNAL_CONTENT = "# hand-written by another process between plan and commit\nDo not touch.\n";

    // AGENTS.md doesn't exist at plan time for a fresh repo — its mutation's
    // existingHash is undefined ("expected absent"). Right as sync stages
    // AGENTS.md's own temp file, simulate another process creating the real
    // destination file out from under it.
    fsFail.concurrentCreateDestBasename = AGENTS;
    fsFail.concurrentCreateContent = EXTERNAL_CONTENT;

    const guidance = [
      `A mutation whose destination was absent at plan time (existingHash`,
      `undefined) must still be re-checked against disk immediately before`,
      `its commit-phase rename — if something else created it since sync`,
      `started reading, that is an external-change conflict, never a`,
      `silent overwrite of the concurrently-created file (src/sync.ts`,
      `commitMutations).`,
    ].join("\n");

    const report = applyManifest(ONE_PACKAGE, dir, true);
    fsFail.concurrentCreateDestBasename = undefined;

    expect(readFileSync(join(dir, AGENTS), "utf8"), guidance).toBe(EXTERNAL_CONTENT);
    const agentsFile = report.files.find((f) => f.path === AGENTS);
    expect(agentsFile?.conflicts, guidance).toContain("external-change");
    expect(agentsFile?.written, guidance).toBe(false);
    expect(report.hasConflicts, guidance).toBe(true);

    // Unrelated mutations in the same run are unaffected by the one conflict.
    expect(existsSync(join(dir, RULE_KARPATHY)), guidance).toBe(true);
    assertNoLeftoverTempFiles(dir);
  });
});
