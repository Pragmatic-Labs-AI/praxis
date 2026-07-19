import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram, reconcile } from "../src/program.js";

/**
 * Conformance: the advisory methodology-size line (D45) reports the
 * always-loaded rule-artifact surface computed from the
 * planned emit, and degrades by omission — never by throwing or masking the
 * sync error — when the manifest can't resolve (mirrors the D40/D41
 * anchor-tripwire model, but manifest-*dependent* rather than independent).
 *
 * Prior art: anchors.conformance.test.ts (the unresolvable-manifest fixture and
 * the reconcile()-as-pure-function seam).
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempProject(manifestYaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-methsize-conf-"));
  dirs.push(dir);
  writeFileSync(join(dir, "praxis.yaml"), manifestYaml, "utf8");
  return dir;
}

const CLAUDE_CODE_MANIFEST = `
version: 1
methodology: "0.1.0"
targets: [claude-code]
packages: [karpathy-claude]
`;

const AGENTS_MD_ONLY_MANIFEST = `
version: 1
methodology: "0.1.0"
targets: [agents-md]
packages: [karpathy-claude]
`;

const UNRESOLVABLE_MANIFEST = `
version: 1
methodology: "0.1.0"
targets: [claude-code]
packages: [this-package-does-not-exist]
`;

/** Line count of the neutral source this fixture's one rules package emits —
 *  the expected total for a single-package manifest, on either target. */
function expectedKarpathyLines(): number {
  const source = readFileSync(
    join(process.cwd(), "packages", "layer1", "karpathy-claude", "rules.md"),
    "utf8",
  ).trimEnd();
  return source.split("\n").length;
}

describe("conformance: advisory methodology-size line", () => {
  it("reports the planned-emit line/file count for the claude-code target", () => {
    const dir = tempProject(CLAUDE_CODE_MANIFEST);
    const result = reconcile(dir, false, "check");

    const guidance = [
      `Methodology size didn't match the planned emit for a single-package,`,
      `claude-code-only manifest. computeMethodologySize (src/emit.ts) must count`,
      `content lines of each owned .claude/rules/*.md op planEmit produces for the`,
      `claude-code target — one file per rules package (karpathy-claude here).`,
    ].join("\n");
    expect(result.methodologySize, guidance).toEqual({
      totalLines: expectedKarpathyLines(),
      fileCount: 1,
    });
  });

  it("falls back to the agents-md block content when claude-code isn't a target", () => {
    const dir = tempProject(AGENTS_MD_ONLY_MANIFEST);
    const result = reconcile(dir, false, "check");

    const guidance = [
      `Methodology size didn't fall back to the agents-md block when claude-code is`,
      `absent from manifest.targets. computeMethodologySize (src/emit.ts) must count`,
      `the agents-md managed block's content per rules package — the same source`,
      `rendered once, never double-counted against a claude-code op that doesn't exist.`,
    ].join("\n");
    expect(result.methodologySize, guidance).toEqual({
      totalLines: expectedKarpathyLines(),
      fileCount: 1,
    });
  });

  it("omits the line — rather than erroring — when the manifest can't resolve", () => {
    const dir = tempProject(UNRESOLVABLE_MANIFEST);
    const result = reconcile(dir, false, "check");

    const guidance = [
      `praxis check threw, or fabricated a methodology-size line, for an`,
      `unresolvable manifest. Per the D40 degrade-by-omission model,`,
      `computeMethodologySize's caller in reconcile() (src/program.ts) must catch`,
      `the loadManifest/planEmit failure and leave methodologySize undefined — the`,
      `sync error already reports the unresolvable package; this line must never`,
      `mask or duplicate it.`,
    ].join("\n");
    expect(result.syncError, guidance).toBeDefined();
    expect(result.methodologySize, guidance).toBeUndefined();
    // Omission must not come at the cost of the exit code (unchanged in all cases).
    expect(result.exitCode, guidance).toBe(1);
  });

  it("prints a greppable line in check's console output; sync prints none", async () => {
    const dir = tempProject(CLAUDE_CODE_MANIFEST);
    const cwd = process.cwd();
    const exitCode = process.exitCode;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      process.exitCode = undefined;
      process.chdir(dir);

      const checkGuidance = [
        `praxis check's console output must contain a`,
        `"Methodology size: <N> lines across <M> always-loaded rule files." line`,
        `(greppable — the emitted /praxis-upkeep command reads check output).`,
        `Wire it in runReconcile() in src/program.ts, matching the anchor line's`,
        `console.log style.`,
      ].join("\n");
      await buildProgram().parseAsync(["node", "praxis", "check"], { from: "node" });
      const checkLines = log.mock.calls.map((c) => String(c[0]));
      expect(
        checkLines.some((l) => /^Methodology size: \d+ lines across \d+ always-loaded rule files\.$/.test(l)),
        checkGuidance,
      ).toBe(true);

      log.mockClear();
      const syncGuidance = [
        `praxis sync printed a methodology-size line. The behavior contract limits`,
        `this report to check mode (sync already shows a diff) — guard it with`,
        `mode === "check" in reconcile() (src/program.ts).`,
      ].join("\n");
      await buildProgram().parseAsync(["node", "praxis", "sync"], { from: "node" });
      const syncLines = log.mock.calls.map((c) => String(c[0]));
      expect(
        syncLines.some((l) => l.startsWith("Methodology size:")),
        syncGuidance,
      ).toBe(false);
    } finally {
      process.chdir(cwd);
      process.exitCode = exitCode;
      log.mockRestore();
      error.mockRestore();
    }
  });
});
