import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirm } from "@clack/prompts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderManifestYaml } from "../src/init.js";
import { loadManifest, type Manifest } from "../src/manifest.js";
import { reconcile, runSyncAction } from "../src/program.js";
import { praxisVersion } from "../src/version.js";

/**
 * Conformance: the interactive `praxis sync` confirm-to-bump prompt — D59's
 * previously-deferred sub-item, shipped here (D62). Mirrors
 * sync-transactional.conformance.test.ts's `vi.mock` shape, applied to
 * "@clack/prompts"'s `confirm` instead of "node:fs": the fake terminal below
 * (`setTTY`) never touches a real pty, so these tests exercise the exact
 * confirm/decline branches deterministically, without hanging on real stdin.
 */

const clack = vi.hoisted(() => ({ confirmResult: true as boolean }));

vi.mock("@clack/prompts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clack/prompts")>();
  return {
    ...actual,
    confirm: vi.fn(async () => clack.confirmResult),
    cancel: vi.fn(),
  };
});

const dirs: string[] = [];
let stdinTTY: PropertyDescriptor | undefined;
let stdoutTTY: PropertyDescriptor | undefined;

afterEach(() => {
  clack.confirmResult = true;
  vi.clearAllMocks(); // each test's `confirm` call-count assertion must be independent of prior tests' calls
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  if (stdinTTY) Object.defineProperty(process.stdin, "isTTY", stdinTTY);
  if (stdoutTTY) Object.defineProperty(process.stdout, "isTTY", stdoutTTY);
  stdinTTY = undefined;
  stdoutTTY = undefined;
});

/** Fake a real interactive terminal (or its absence) without a pty — the gate
 *  `isInteractiveTerminal` (src/program.ts) reads. Restored in afterEach. */
function setTTY(value: boolean): void {
  stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
}

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-sync-confirm-"));
  dirs.push(dir);
  return dir;
}

// Parses as a valid version, strictly older than any real release — the
// "upgrade available" case (running CLI newer than the pin).
const STALE_PIN = "0.0.1";

function stalePinnedManifest(): Manifest {
  return { version: 1, methodology: STALE_PIN, targets: ["agents-md"], packages: ["karpathy-claude"] };
}

const AGENTS = "AGENTS.md";

describe("conformance: interactive sync confirm-to-bump (D59/D62)", () => {
  it("confirm=true rewrites praxis.yaml's methodology to the running version and applies the sync; a follow-up check is clean", async () => {
    const dir = tempProject();
    const manifestPath = join(dir, "praxis.yaml");
    writeFileSync(manifestPath, renderManifestYaml(stalePinnedManifest()), "utf8");
    setTTY(true);
    clack.confirmResult = true;

    await runSyncAction({}, dir);

    const running = praxisVersion();
    const guidance =
      "confirm=true must rewrite praxis.yaml's methodology: to the running CLI's " +
      "version (offerMethodologyBump, src/program.ts) as part of the one confirmed action.";
    expect(loadManifest(manifestPath).methodology, guidance).toBe(running);
    expect(existsSync(join(dir, AGENTS)), guidance).toBe(true);
    expect(readFileSync(join(dir, AGENTS), "utf8"), guidance).toMatch(/praxis:begin karpathy-claude/);

    const check = reconcile(dir, false, "check");
    expect(check.syncReport?.changed, "a follow-up check must be clean once the bump and apply both landed").toBe(
      false,
    );
    expect(check.exitCode).toBe(0);
  });

  it("confirm=false writes nothing: praxis.yaml is byte-identical and no content is applied", async () => {
    const dir = tempProject();
    const manifestPath = join(dir, "praxis.yaml");
    const before = renderManifestYaml(stalePinnedManifest());
    writeFileSync(manifestPath, before, "utf8");
    setTTY(true);
    clack.confirmResult = false;

    await runSyncAction({}, dir);

    const guidance =
      "confirm=false (decline) must abort with nothing written at all — never a bumped " +
      "praxis.yaml with unsynced content (offerMethodologyBump, src/program.ts).";
    expect(readFileSync(manifestPath, "utf8"), guidance).toBe(before);
    expect(existsSync(join(dir, AGENTS)), guidance).toBe(false);
  });

  it("check still fails loud on the same upgrade-available manifest — no prompt", async () => {
    const dir = tempProject();
    const manifestPath = join(dir, "praxis.yaml");
    writeFileSync(manifestPath, renderManifestYaml(stalePinnedManifest()), "utf8");
    setTTY(true); // even with a real terminal available, `check` never prompts

    const result = reconcile(dir, false, "check");
    const guidance = "`check` must never prompt or auto-bump — an upgrade-available pin is always a hard fail there.";
    expect(result.exitCode, guidance).toBe(1);
    expect(result.syncError, guidance).toMatch(new RegExp(STALE_PIN.replace(/\./g, "\\.")));
    expect(existsSync(join(dir, AGENTS)), guidance).toBe(false);
  });

  it("sync --yes fails loud on the same manifest without prompting, and writes nothing", async () => {
    const dir = tempProject();
    const manifestPath = join(dir, "praxis.yaml");
    const before = renderManifestYaml(stalePinnedManifest());
    writeFileSync(manifestPath, before, "utf8");
    setTTY(true); // a real terminal is available; --yes must still skip the prompt

    await runSyncAction({ yes: true }, dir);

    const guidance = "`sync --yes` must never prompt (D6) — it keeps the pre-existing fail-loud behavior verbatim.";
    expect(confirm, guidance).not.toHaveBeenCalled();
    expect(readFileSync(manifestPath, "utf8"), guidance).toBe(before);
    expect(existsSync(join(dir, AGENTS)), guidance).toBe(false);
  });

  it("a non-interactive terminal (no TTY) fails loud without prompting, same as --yes", async () => {
    const dir = tempProject();
    const manifestPath = join(dir, "praxis.yaml");
    const before = renderManifestYaml(stalePinnedManifest());
    writeFileSync(manifestPath, before, "utf8");
    setTTY(false);

    await runSyncAction({}, dir);

    const guidance = "A piped/CI/non-TTY sync must never prompt — only a real interactive TTY offers the bump.";
    expect(confirm, guidance).not.toHaveBeenCalled();
    expect(readFileSync(manifestPath, "utf8"), guidance).toBe(before);
    expect(existsSync(join(dir, AGENTS)), guidance).toBe(false);
  });

  it("preserves hand-written comments/formatting: only the methodology: line changes, everything else is byte-identical", async () => {
    const dir = tempProject();
    const manifestPath = join(dir, "praxis.yaml");
    const before = [
      "# our team's praxis.yaml — please don't reformat this file",
      "version: 1",
      `methodology: "${STALE_PIN}" # bumped only via \`praxis sync\``,
      "",
      "targets: [agents-md]",
      "packages: [karpathy-claude]",
      "",
    ].join("\n");
    writeFileSync(manifestPath, before, "utf8");
    setTTY(true);
    clack.confirmResult = true;

    await runSyncAction({}, dir);

    const running = praxisVersion();
    const guidance =
      "A confirmed bump must be a targeted text edit (setMethodologyInYaml, src/methodology.ts), " +
      "never a renderManifestYaml re-render — a hand-edited praxis.yaml's comments and formatting " +
      "must survive byte-for-byte apart from the methodology: value itself.";
    const afterLines = readFileSync(manifestPath, "utf8").split("\n");
    const beforeLines = before.split("\n");
    expect(afterLines.length, guidance).toBe(beforeLines.length);
    for (let i = 0; i < beforeLines.length; i++) {
      if (i === 2) continue; // the rewritten methodology: line itself
      expect(afterLines[i], guidance).toBe(beforeLines[i]);
    }
    expect(afterLines[2], guidance).toBe(`methodology: "${running}" # bumped only via \`praxis sync\``);
  });

  it("a reconcile failure after a confirmed bump rolls back the pin: praxis.yaml is restored, not left bumped", async () => {
    const dir = tempProject();
    const manifestPath = join(dir, "praxis.yaml");
    // "not-a-real-package" passes praxis.yaml's shape validation (loadManifest,
    // which offerMethodologyBump uses) but fails later, at plan time
    // (resolvePackages, called from planEmit inside runSync/reconcile) — so
    // the bump confirm still fires, but the reconcile that's supposed to
    // accompany it fails.
    const before = renderManifestYaml({
      version: 1,
      methodology: STALE_PIN,
      targets: ["agents-md"],
      packages: ["not-a-real-package"],
    });
    writeFileSync(manifestPath, before, "utf8");
    setTTY(true);
    clack.confirmResult = true;

    await runSyncAction({}, dir);

    const guidance =
      "D59 treats the confirmed bump and its content apply as one action: when the apply " +
      "(runReconcile) fails, offerMethodologyBump's write must be rolled back — praxis.yaml's " +
      "methodology: must be restored to its original value, never left bumped with unsynced content.";
    expect(readFileSync(manifestPath, "utf8"), guidance).toBe(before);
    expect(loadManifest(manifestPath).methodology, guidance).toBe(STALE_PIN);
    expect(existsSync(join(dir, AGENTS)), guidance).toBe(false);
  });

  it("MethodologyIncompatibleError (pinned newer than running) is never offered, even interactively", async () => {
    const dir = tempProject();
    const manifestPath = join(dir, "praxis.yaml");
    const aheadManifest: Manifest = { version: 1, methodology: "9999.0.0", targets: ["agents-md"], packages: ["karpathy-claude"] };
    const before = renderManifestYaml(aheadManifest);
    writeFileSync(manifestPath, before, "utf8");
    setTTY(true);

    await runSyncAction({}, dir);

    const guidance = "A pin ahead of the running CLI has nothing to offer — it must hard-fail, never prompt.";
    expect(confirm, guidance).not.toHaveBeenCalled();
    expect(readFileSync(manifestPath, "utf8"), guidance).toBe(before);
    expect(existsSync(join(dir, AGENTS)), guidance).toBe(false);
  });
});
