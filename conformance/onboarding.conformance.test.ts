import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SETUP_SENTINEL, applyInit, defaultManifest, detectContext } from "../src/init.js";
import { SHARED_PROJECT_BEGIN, SHARED_PROJECT_END } from "../src/shared-instructions.js";
import { runSync } from "../src/sync.js";

/**
 * Conformance: the `.praxis-setup-pending` sentinel (D14 onboarding mechanism,
 * docs/wiki/onboarding.md). Key invariants:
 *
 * 1. Written on a fresh repo (no CLAUDE.md, claude-code in targets).
 * 2. NOT written when every selected first-class target has its instruction surface.
 * 3. After applyInit on a fresh repo, `praxis check` reports no drift —
 *    proving the sentinel is NOT a managed/synced file.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-onboarding-conf-"));
  dirs.push(dir);
  return dir;
}

describe("conformance: onboarding sentinel", () => {
  it("sentinel IS written on a fresh repo (no CLAUDE.md, claude-code target)", () => {
    const dir = tempDir();
    const ctx = detectContext(dir);
    const manifest = defaultManifest(ctx);
    const guidance = [
      `The .praxis-setup-pending sentinel was not written after init on a fresh repo.`,
      `applyInit must call writeSetupSentinel when !ctx.hasClaudeMd && manifest.targets.includes("claude-code").`,
      `Check applyInit() in src/init.ts and the sentinel gate condition.`,
    ].join("\n");

    // Precondition: no CLAUDE.md, claude-code in default targets
    expect(ctx.hasClaudeMd, "test precondition: CLAUDE.md must not exist").toBe(false);
    expect(manifest.targets, "test precondition: claude-code must be in targets").toContain(
      "claude-code",
    );

    applyInit(dir, manifest, ctx);

    expect(existsSync(join(dir, SETUP_SENTINEL)), guidance).toBe(true);
  });

  it("sentinel is NOT written when selected instruction surfaces exist", () => {
    const dir = tempDir();
    const shared = `${SHARED_PROJECT_BEGIN}\n# Project\n${SHARED_PROJECT_END}\n`;
    writeFileSync(join(dir, "CLAUDE.md"), shared, "utf8");
    writeFileSync(join(dir, "AGENTS.md"), shared, "utf8");
    const ctx = detectContext(dir);
    const manifest = defaultManifest(ctx);
    const guidance = [
      `The .praxis-setup-pending sentinel was written even though every selected`,
      `first-class target already has its project instruction surface.`,
      `Check the gate condition in applyInit() in src/init.ts.`,
    ].join("\n");

    expect(ctx.hasClaudeMd, "test precondition: CLAUDE.md must exist").toBe(true);

    applyInit(dir, manifest, ctx);

    expect(existsSync(join(dir, SETUP_SENTINEL)), guidance).toBe(false);
  });

  it("sentinel is NOT a managed/synced file — check reports no drift after fresh init", () => {
    const dir = tempDir();
    const ctx = detectContext(dir);
    const manifest = defaultManifest(ctx);
    const guidance = [
      `After init on a fresh repo, \`praxis check\` reports drift — the sentinel`,
      `is being treated as a managed file. The sentinel must be written OUTSIDE`,
      `applyManifest/the sync pipeline so that a follow-up check is a clean no-op.`,
      `Check applyInit() in src/init.ts: writeSetupSentinel must be called directly,`,
      `not through planEmit()/applyManifest().`,
    ].join("\n");

    applyInit(dir, manifest, ctx);

    // Sentinel is present but must NOT appear as drift
    expect(existsSync(join(dir, SETUP_SENTINEL)), "sentinel should be written").toBe(true);
    const check = runSync({ cwd: dir, write: false });
    expect(check.changed, guidance).toBe(false);
    expect(check.hasConflicts, guidance).toBe(false);
  });
});
