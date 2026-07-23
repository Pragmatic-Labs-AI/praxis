import { basename, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { applyOp, planEmit } from "../src/emit.js";
import { TARGETS, type Manifest } from "../src/manifest.js";
import { availablePackages } from "../src/packages.js";
import { loadPluginsBlock } from "../src/plugins.js";
import { currentMethodology } from "../test/helpers.js";

/**
 * Conformance: the declarative plugin-marketplace artifact (fourth `provides`
 * kind, docs/wiki/packages-and-emit.md/docs/wiki/emitters.md) is emitted per-tool, never executed. A
 * thin `packages/external/<pkg>/` package declares a Claude Code plugin
 * marketplace + which plugins to enable; Praxis writes that declaration into
 * `.claude/settings.json` (`extraKnownMarketplaces` + `enabledPlugins`) via the
 * JSON merge engine — no npx, no git clone, no network at sync.
 *
 * Data-driven: the invariants below hold for EVERY package that declares
 * `provides: [plugins]`, so a new plugin package is covered the moment it ships
 * its package.yaml — no test edit required (mirrors commands.conformance.test.ts, D24).
 */

const PLUGIN_PACKAGES = [...availablePackages().values()]
  .filter((p) => p.provides.includes("plugins"))
  .map((p) => p.name)
  .sort();

/** Look up a shipped package's directory by name — loadPluginsBlock is dir-based. */
function dirOf(pkg: string): string {
  return availablePackages().get(pkg)!.dir;
}

const manifestWith = (pkg: string): Manifest => ({
  version: 1,
  methodology: currentMethodology(),
  targets: ["claude-code", "agents-md"],
  packages: [pkg],
});

describe("conformance: plugin marketplaces", () => {
  it("has at least one package providing plugins", () => {
    const guidance = [
      `No package declares 'provides: [plugins]'. A plugins package ships plugins.yaml plus a`,
      `package.yaml with "plugins" in provides. Prior art: packages/external/ponytail/.`,
    ].join("\n");
    expect(PLUGIN_PACKAGES.length, guidance).toBeGreaterThan(0);
  });

  it.each(PLUGIN_PACKAGES)("%s ships a well-formed plugins.yaml", (pkg) => {
    const guidance = [
      `The ${pkg} package declares it provides plugins but plugins.yaml is missing or invalid.`,
      `Check loadPluginsBlock() in src/plugins.ts and packages/external/${pkg}/plugins.yaml.`,
    ].join("\n");
    const block = loadPluginsBlock(dirOf(pkg));
    expect(block, guidance).toBeDefined();
    expect(block!.marketplace.name.length, guidance).toBeGreaterThan(0);
    expect(block!.enable.length, guidance).toBeGreaterThan(0);
  });

  it.each(PLUGIN_PACKAGES)("%s declares targets that are all known emit targets", (pkg) => {
    const guidance = [
      `The ${pkg} package's plugins.yaml declares a target outside the known Target enum`,
      `(src/manifest.ts TARGETS). plugins.yaml targets must be a subset of what Praxis can`,
      `actually emit for. Check packages/external/${pkg}/plugins.yaml.`,
    ].join("\n");
    const block = loadPluginsBlock(dirOf(pkg))!;
    for (const t of block.targets) {
      expect(TARGETS, guidance).toContain(t);
    }
  });

  it.each(PLUGIN_PACKAGES)("%s every enable entry matches its declared marketplace", (pkg) => {
    const guidance = [
      `The ${pkg} package's plugins.yaml has an 'enable' entry whose "@<marketplace>" suffix`,
      `does not match marketplace.name. parsePluginsBlock() in src/plugins.ts must fail loud on`,
      `this — if this test runs at all the package.yaml loaded, so re-check the mismatch directly.`,
    ].join("\n");
    const block = loadPluginsBlock(dirOf(pkg))!;
    for (const entry of block.enable) {
      expect(entry.endsWith(`@${block.marketplace.name}`), guidance).toBe(true);
    }
  });

  it.each(PLUGIN_PACKAGES)(
    "%s emits a settings op declaring the marketplace + enabled plugin for Claude Code",
    (pkg) => {
      const ops = planEmit(manifestWith(pkg)).filter((o) => o.kind === "settings" && o.plugins);
      const guidance = [
        `Claude Code must receive a settings op carrying plugins, writing .claude/settings.json with`,
        `extraKnownMarketplaces + enabledPlugins (docs/wiki/emitters.md). Check PLUGIN_EMITTERS and the`,
        `plugins branch of planEmit() in src/emit.ts.`,
      ].join("\n");
      const claude = ops.find((o) => o.target === "claude-code");
      expect(claude, guidance).toBeDefined();
      expect(claude!.path, guidance).toBe(".claude/settings.json");
      if (claude!.kind !== "settings" || !claude!.plugins) throw new Error("expected settings op with plugins");
      const block = loadPluginsBlock(dirOf(pkg))!;
      expect(claude!.plugins.marketplaces.map((m) => m.name), guidance).toContain(block.marketplace.name);
      for (const entry of block.enable) {
        expect(claude!.plugins.enable, guidance).toContain(entry);
      }
    },
  );

  it.each(PLUGIN_PACKAGES)(
    "%s emits nothing for targets with no plugin model (no-op, not a fabricated file)",
    (pkg) => {
      const ops = planEmit(manifestWith(pkg)).filter((o) => o.kind === "settings" && o.plugins);
      const guidance = [
        `A plugins-bearing settings op was emitted for a target with no plugin model. Targets absent`,
        `from PLUGIN_EMITTERS (e.g. agents-md, which has no plugin-marketplace concept) must emit`,
        `NOTHING for plugins — never a fabricated settings file. Check planEmit() in src/emit.ts.`,
      ].join("\n");
      expect(ops.some((o) => o.target === "agents-md"), guidance).toBe(false);
    },
  );

  it("emits no plugins-bearing op when no selected package provides plugins", () => {
    const noPlugins: Manifest = { ...manifestWith("karpathy-claude"), packages: ["karpathy-claude"] };
    const ops = planEmit(noPlugins).filter((o) => o.kind === "settings" && o.plugins);
    const guidance = [
      `A plugins-bearing settings op was emitted though no selected package provides plugins.`,
      `Plugin marketplaces are opt-in (their own package); planEmit must emit them only when a`,
      `selected package's 'provides' includes "plugins". Check planEmit() in src/emit.ts.`,
    ].join("\n");
    expect(ops.length, guidance).toBe(0);
  });

  it.each(PLUGIN_PACKAGES)("%s produces a real EmitOp and re-applies as a no-op (idempotent)", (pkg) => {
    const op = planEmit(manifestWith(pkg)).find((o) => o.kind === "settings" && o.plugins)!;
    const guidance = [
      `Plugin emit is not idempotent: re-applying changed the destination. A second sync with the`,
      `same declaration must be a no-op (docs/wiki/merge-engine.md). Check applyOp()/reconcileSettings().`,
    ].join("\n");
    expect(op, guidance).toBeDefined();
    const first = applyOp(op, "");
    const second = applyOp(op, first.text);
    expect(second.changed, guidance).toBe(false);
    expect(second.text, guidance).toBe(first.text);
    // Praxis never executes anything — the emitted text is plain JSON, no shell-out surface.
    expect(() => JSON.parse(first.text), guidance).not.toThrow();
  });
});

/**
 * Conformance: every shipped first-party `packages/external/**` plugin
 * reference is pinned to a full immutable commit SHA (D55). A tag or branch
 * name in `ref` is a movable label, not an integrity
 * boundary — and an upstream repo with no tags still has commits, so "no
 * tags" is never a reason to leave `ref` unpinned. Resolve a SHA with
 * `git ls-remote <repo> <tag> '<tag>^{}'` (peeled SHA wins for annotated
 * tags) or `git ls-remote <repo> HEAD` when there is no tag to pin to.
 */
const FULL_SHA = /^[0-9a-f]{40}$/;

const EXTERNAL_PLUGIN_PACKAGES = PLUGIN_PACKAGES.filter((pkg) => basename(dirname(dirOf(pkg))) === "external");

describe("conformance: shipped external plugin refs are pinned to a commit SHA", () => {
  it("has at least one packages/external plugin package to check", () => {
    const guidance = [
      `No package under packages/external/ declares 'provides: [plugins]'. This invariant only`,
      `applies to first-party shipped external plugin packages; if the layout moved, update`,
      `EXTERNAL_PLUGIN_PACKAGES in conformance/plugins.conformance.test.ts to match.`,
    ].join("\n");
    expect(EXTERNAL_PLUGIN_PACKAGES.length, guidance).toBeGreaterThan(0);
  });

  it.each(EXTERNAL_PLUGIN_PACKAGES)("%s pins marketplace.source.ref to a full commit SHA", (pkg) => {
    const block = loadPluginsBlock(dirOf(pkg))!;
    const { ref } = block.marketplace.source;
    const guidance = [
      `packages/external/${pkg}/plugins.yaml's marketplace.source.ref is "${ref ?? "(missing)"}", not a full`,
      `40-character commit SHA. A tag is a useful label, not an integrity boundary, and an upstream`,
      `repo without tags still has commits — never ship an unpinned first-party external plugin`,
      `reference. Resolve the SHA with "git ls-remote <repo> <tag> '<tag>^{}'" (or "... HEAD" when`,
      `there is no tag), set marketplace.source.ref to it, and keep the tag/HEAD label as a trailing`,
      `comment. See packages/external/ponytail/plugins.yaml for prior art.`,
    ].join("\n");
    expect(ref, guidance).toBeDefined();
    expect(FULL_SHA.test(ref ?? ""), guidance).toBe(true);
  });

  it("FULL_SHA rejects a movable tag/branch and an absent ref (the invariant actually discriminates)", () => {
    expect(FULL_SHA.test("v4.7.0")).toBe(false);
    expect(FULL_SHA.test("main")).toBe(false);
    expect(FULL_SHA.test("")).toBe(false);
    expect(FULL_SHA.test("adad50d9b393926b2dd5ed7225dcb1848b9df408")).toBe(true);
    // Case-sensitive: a SHA is always rendered lowercase by git; an uppercase
    // look-alike is a fabrication, not a resolved ref, so it must not pass.
    expect(FULL_SHA.test("ADAD50D9B393926B2DD5ED7225DCB1848B9DF408")).toBe(false);
  });
});
