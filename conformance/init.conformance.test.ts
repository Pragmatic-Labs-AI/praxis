import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyInit, defaultManifest, detectContext, renderManifestYaml } from "../src/init.js";
import { parseManifest } from "../src/manifest.js";
import { availablePackages } from "../src/packages.js";
import { runSync } from "../src/sync.js";

/**
 * Conformance: `init` produces declarative truth that the loader accepts and
 * lands a fresh repo fully in sync (docs/wiki/interaction-model.md, D17). If init writes a
 * manifest `sync`/`check` can't read, or leaves the repo drifting, the install
 * is broken on arrival.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-init-conf-"));
  dirs.push(dir);
  return dir;
}

describe("conformance: init", () => {
  it("emits a praxis.yaml the manifest loader round-trips", () => {
    const manifest = defaultManifest(detectContext(tempDir()));
    const guidance = [
      `init produced a praxis.yaml the loader cannot parse back to the same manifest.`,
      `The wizard writes the declarative truth that sync/check read every run — render and`,
      `parse must round-trip exactly. Check renderManifestYaml() in src/init.ts against the`,
      `schema in src/manifest.ts.`,
    ].join("\n");
    expect(parseManifest(renderManifestYaml(manifest)), guidance).toEqual(manifest);
  });

  it("lands a fresh repo fully in sync — check reports no drift after init", () => {
    const dir = tempDir();
    const guidance = [
      `After init, \`praxis check\` still reports drift — the repo isn't actually installed.`,
      `applyInit must write praxis.yaml AND emit every managed file so a follow-up check is a`,
      `no-op (docs/wiki/interaction-model.md). Check applyInit()/applyManifest() wiring.`,
    ].join("\n");
    const ctx = detectContext(dir);
    applyInit(dir, defaultManifest(ctx), ctx);
    const check = runSync({ cwd: dir, write: false });
    expect(check.changed, guidance).toBe(false);
    expect(check.hasConflicts, guidance).toBe(false);
  });

  it("quick-start default includes every layer1 package", () => {
    // Guard: adding a new Layer 1 package must not silently omit it from the
    // easy install. defaultManifest() is data-driven from availablePackages() —
    // this test catches any regression where a layer1 package is excluded.
    const all = availablePackages();
    const layer1Names = [...all.values()]
      .filter((pkg) => pkg.layer === "layer1")
      .map((pkg) => pkg.name)
      .sort();

    const manifest = defaultManifest(detectContext(tempDir()));
    const missingFromDefault = layer1Names.filter((name) => !manifest.packages.includes(name));

    const guidance = [
      `The quick-start default manifest is missing these Layer 1 package(s): ${missingFromDefault.join(", ")}.`,
      `defaultManifest() in src/init.ts must include every layer1 package from availablePackages().`,
      `Check the filter in defaultManifest(): it should select pkg.layer === "layer1" for ALL`,
      `layer1 packages, then append layer2 packages for the detected stacks.`,
      `Mirror the data-driven logic in src/init.ts — do not hardcode the package list.`,
    ].join("\n");

    expect(missingFromDefault, guidance).toHaveLength(0);
  });
});
