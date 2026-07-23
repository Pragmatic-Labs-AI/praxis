import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reconcile } from "../src/program.js";
import { currentMethodology } from "../test/helpers.js";

/**
 * Conformance: the knowledge-anchor tripwire (D26/D27) must fire in `check` mode
 * regardless of whether the manifest resolves.
 *
 * Prior art (conformance/README.md): a repo invariant whose failure message
 * tells the coding agent what broke, where, and why.
 *
 * Why this exists (D40): `praxis check` used to run `runSync` first and only then
 * the anchor check, inside one try/catch. An unresolvable `praxis.yaml` (e.g. an
 * old npx-cached CLI that predates a package the manifest lists) made `runSync`
 * throw, so the anchor check never ran and its silence read to `/praxis-upkeep`
 * as "0 checked, all fine" — a dark tripwire. The anchor check reads markdown
 * only and needs nothing from the manifest, so it must survive a sync failure.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A temp repo whose praxis.yaml lists a package no CLI knows, plus one anchored page. */
function repoWithUnresolvableManifest(): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-anchor-conf-"));
  dirs.push(dir);

  writeFileSync(
    join(dir, "praxis.yaml"),
    [
      "version: 1",
      `methodology: "${currentMethodology()}"`,
      "targets: [claude-code]",
      "packages: [this-package-does-not-exist]",
      "",
    ].join("\n"),
  );

  mkdirSync(join(dir, "docs", "wiki"), { recursive: true });
  writeFileSync(
    join(dir, "docs", "wiki", "page.md"),
    ["---", "praxisAnchors:", "  - type: path", "    target: praxis.yaml", "---", "", "# Page", ""].join(
      "\n",
    ),
  );

  return dir;
}

describe("conformance: anchor tripwire is decoupled from manifest resolution", () => {
  it("still checks anchors when praxis check can't resolve the manifest", () => {
    const dir = repoWithUnresolvableManifest();
    const result = reconcile(dir, false, "check");

    const guidance = [
      `\`praxis check\` skipped the knowledge-anchor tripwire because the manifest`,
      `failed to resolve (${result.syncError ?? "no sync error captured"}).`,
      ``,
      `The anchor check reads markdown only — it must run even when runSync throws,`,
      `or a stale/incompatible CLI silently reports zero anchors (D40). Keep the`,
      `anchor check in reconcile() in src/program.ts independent of the runSync`,
      `try/catch: run checkAnchors() in check mode regardless of syncError.`,
    ].join("\n");

    // The manifest is genuinely unresolvable — that half must still fail loud.
    expect(result.syncError, guidance).toBeDefined();
    // ...but the anchor tripwire must have run anyway and counted the one anchor.
    expect(result.anchorReport, guidance).toBeDefined();
    expect(result.anchorReport?.anchorsChecked, guidance).toBe(1);
    // A resolvable anchor plus an unresolvable manifest still exits non-zero.
    expect(result.exitCode, guidance).toBe(1);
  });
});
