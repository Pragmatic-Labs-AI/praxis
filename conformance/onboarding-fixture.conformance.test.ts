import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SETUP_SENTINEL, applyInit, defaultManifest, detectContext } from "../src/init.js";
import { runSync } from "../src/sync.js";

/**
 * Conformance: first-run deterministic surface exercised via the checked-in
 * fixture (examples/fresh-app). Self-hosting cannot exercise this path because
 * Praxis already has CLAUDE.md + docs/wiki/ — the fixture provides a real,
 * repeatable first-run target without touching the checked-in directory.
 *
 * What we assert (the deterministic surface — D12 means CI can't run the live
 * /praxis-onboard agent flow):
 *
 * 1. Sentinel is written after init on the fixture copy.
 * 2. Emitted .claude/commands/praxis-onboard.md contains a /praxis-wiki
 *    delegation bullet (wiki-memory package declares the onboarding hook).
 * 3. Emitted .claude/commands/praxis-onboard.md references /praxis-upkeep
 *    (the handoff step in the onboard skill).
 * 4. `praxis check` reports no drift — the fixture install is clean on arrival.
 *
 * The live /praxis-onboard flow (agent authors CLAUDE.md facts, seeds the wiki,
 * hands off to /praxis-upkeep, removes the sentinel) is manual — see
 * docs/wiki/onboarding.md for the dogfood ritual.
 */

const FIXTURE_DIR = join(import.meta.dirname ?? "", "..", "examples", "fresh-app");
const ONBOARD_COMMAND = join(".claude", "commands", "praxis-onboard.md");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-fixture-conf-"));
  dirs.push(dir);
  return dir;
}

/** Copy the checked-in fixture into a fresh tmpdir. Never run init in place. */
function copyFixture(): string {
  const dir = tempDir();
  cpSync(FIXTURE_DIR, dir, { recursive: true });
  return dir;
}

describe("conformance: first-run fixture (examples/fresh-app)", () => {
  it("fixture detects as node stack (package.json present, no react dep)", () => {
    const dir = copyFixture();
    const ctx = detectContext(dir);
    const guidance = [
      `examples/fresh-app/ must be detected as the "node" stack — it has a package.json`,
      `with no "react" dependency. detectContext() in src/init.ts checks for package.json`,
      `to push "node". Check that the fixture's package.json exists and has no react dep.`,
    ].join("\n");
    expect(ctx.detectedStacks, guidance).toContain("node");
    expect(ctx.detectedStacks, guidance).not.toContain("react");
    expect(ctx.hasClaudeMd, "fixture must not have a CLAUDE.md — it is a fresh-repo target").toBe(
      false,
    );
  });

  it("sentinel is written after init on the fixture copy", () => {
    const dir = copyFixture();
    const ctx = detectContext(dir);
    const manifest = defaultManifest(ctx);
    const guidance = [
      `The .praxis-setup-pending sentinel was not written after init on the fixture copy.`,
      `The fixture has no CLAUDE.md and the default manifest includes claude-code —`,
      `applyInit must call writeSetupSentinel. Check the gate in applyInit() in src/init.ts.`,
    ].join("\n");

    applyInit(dir, manifest, ctx);

    expect(existsSync(join(dir, SETUP_SENTINEL)), guidance).toBe(true);
  });

  it("emitted praxis-onboard command contains /praxis-wiki delegation", () => {
    const dir = copyFixture();
    const ctx = detectContext(dir);
    const manifest = defaultManifest(ctx);
    const guidance = [
      `The emitted .claude/commands/praxis-onboard.md does not contain a /praxis-wiki`,
      `delegation bullet. When wiki-memory is in the manifest (it is in the default),`,
      `planEmit must compose a "- /praxis-wiki" bullet from the package's onboarding hook`,
      `(declared in packages/layer1/wiki-memory/package.yaml). Check the`,
      `<!-- praxis:bootstrap-delegations --> splice logic in src/emit.ts.`,
    ].join("\n");

    applyInit(dir, manifest, ctx);

    const onboardPath = join(dir, ONBOARD_COMMAND);
    expect(existsSync(onboardPath), `${ONBOARD_COMMAND} must be emitted after init`).toBe(true);
    const content = readFileSync(onboardPath, "utf8");
    // The marker must never survive into emitted output
    expect(content, "praxis:bootstrap-delegations marker must not survive into emitted output").not.toContain(
      "<!-- praxis:bootstrap-delegations -->",
    );
    // wiki-memory declares a /praxis-wiki hook → must appear as a delegation bullet.
    // The emitted bullet may wrap /praxis-wiki in backticks: `- \`/praxis-wiki\``
    expect(content, guidance).toMatch(/^- [`]?\/praxis-wiki/m);
  });

  it("emitted praxis-onboard command contains /praxis-capture-codebase-patterns delegation", () => {
    const dir = copyFixture();
    const ctx = detectContext(dir);
    const manifest = defaultManifest(ctx);
    const guidance = [
      `The emitted .claude/commands/praxis-onboard.md does not contain a`,
      `/praxis-capture-codebase-patterns delegation bullet. capture-codebase-patterns is a`,
      `layer1 package, so it rides defaultManifest() (src/init.ts) automatically; its`,
      `'onboarding' hook (packages/layer1/capture-codebase-patterns/package.yaml) must`,
      `compose a bullet via the <!-- praxis:bootstrap-delegations --> splice in src/emit.ts,`,
      `same as wiki-memory's.`,
    ].join("\n");

    applyInit(dir, manifest, ctx);

    const content = readFileSync(join(dir, ONBOARD_COMMAND), "utf8");
    expect(content, guidance).toMatch(/^- [`]?\/praxis-capture-codebase-patterns/m);
  });

  it("emitted praxis-onboard command references /praxis-upkeep", () => {
    const dir = copyFixture();
    const ctx = detectContext(dir);
    const manifest = defaultManifest(ctx);
    const guidance = [
      `The emitted .claude/commands/praxis-onboard.md does not reference /praxis-upkeep.`,
      `The onboard command must hand off to /praxis-upkeep after bootstrap actions`,
      `(symmetric front gate, D36). Check the source in`,
      `packages/layer1/onboarding/commands/onboard.md.`,
    ].join("\n");

    applyInit(dir, manifest, ctx);

    const content = readFileSync(join(dir, ONBOARD_COMMAND), "utf8");
    expect(content, guidance).toContain("/praxis-upkeep");
  });

  it("no post-init drift — praxis check reports clean after init on fixture copy", () => {
    const dir = copyFixture();
    const ctx = detectContext(dir);
    const manifest = defaultManifest(ctx);
    const guidance = [
      `After init on the fixture copy, \`praxis check\` reports drift — the fixture`,
      `install is not clean on arrival. applyInit must write praxis.yaml AND emit every`,
      `managed file so a follow-up check is a no-op (docs/wiki/interaction-model.md).`,
      `Check applyInit()/applyManifest() wiring in src/init.ts.`,
    ].join("\n");

    applyInit(dir, manifest, ctx);

    const check = runSync({ cwd: dir, write: false });
    expect(check.changed, guidance).toBe(false);
    expect(check.hasConflicts, guidance).toBe(false);
  });
});
