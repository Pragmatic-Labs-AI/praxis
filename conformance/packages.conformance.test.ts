import { describe, expect, it } from "vitest";
import { planEmit } from "../src/emit.js";
import type { Manifest } from "../src/manifest.js";
import { parsePackageManifest, resolve, type ResolvedPackage } from "../src/packages.js";
import { currentMethodology } from "../test/helpers.js";

/**
 * Conformance: the package loader makes `praxis.yaml`'s package list trustworthy
 * (docs/wiki/packages-and-emit.md, D20/D21). An unknown package fails loudly (no silent typo),
 * a package contributes only the artifact kinds it *declares* (provides drives
 * emit, not filesystem probing), and the composition rule (requires/conflicts) is
 * enforced — a rule without its required support is refused.
 */

function manifest(
  packages: string[],
  targets: Manifest["targets"],
  stacks?: Manifest["stacks"],
): Manifest {
  return { version: 1, methodology: currentMethodology(), targets, packages, ...(stacks ? { stacks } : {}) };
}

function pkg(name: string, extra: Partial<ResolvedPackage> = {}): ResolvedPackage {
  return { name, layer: "layer1", provides: ["rules"], requires: [], conflicts: [], dir: `/x/${name}`, ...extra };
}

describe("conformance: package loader", () => {
  it("fails loudly on an unknown package (no silent typo)", () => {
    const guidance = [
      `An unknown package name did not raise an error. praxis.yaml is the declarative truth`,
      `(D4) — a package name with no matching installed package must fail loudly, naming the`,
      `available packages, not silently emit nothing. Check resolve() in src/packages.ts.`,
    ].join("\n");
    expect(() => planEmit(manifest(["karpathy-claude", "no-such-pkg"], ["agents-md"])), guidance).toThrow(
      /no such package/,
    );
  });

  it("emits only the artifact kinds a package declares it provides", () => {
    const guidance = [
      `A package emitted an artifact kind it does not declare in 'provides'. The package`,
      `manifest's 'provides' must drive emit (D20): a rules-only package produces no`,
      `permission op, a permissions-only package produces no rules op. Check planEmit() in`,
      `src/emit.ts uses the resolved packages' 'provides'.`,
    ].join("\n");
    const rulesOnly = planEmit(manifest(["karpathy-claude"], ["claude-code"]));
    expect(rulesOnly.some((o) => o.kind === "settings" && o.rules), guidance).toBe(false);

    const permsOnly = planEmit(manifest(["safe-permissions"], ["claude-code"]));
    expect(permsOnly.length > 0 && permsOnly.every((o) => o.kind === "settings" && o.rules), guidance).toBe(true);

    const commandsOnly = planEmit(manifest(["instruction-upkeep"], ["claude-code"]));
    expect(commandsOnly.length > 0 && commandsOnly.every((o) => o.kind === "owned"), guidance).toBe(true);
    expect(
      commandsOnly.some((o) => o.path.startsWith(".claude/commands/")),
      guidance,
    ).toBe(true);
  });

  it("refuses a package whose requires is not satisfied (composition rule)", () => {
    const guidance = [
      `A package was applied without its required support. The composition rule (docs/wiki/packages-and-emit.md) refuses`,
      `a rule without the package that gives it teeth: if A requires B, B must also be`,
      `selected. Check the requires check in resolve() (src/packages.ts).`,
    ].join("\n");
    const recipe = pkg("recipe", { requires: ["conformance-harness"] });
    const harness = pkg("conformance-harness");
    const available = new Map([recipe, harness].map((p) => [p.name, p]));
    expect(() => resolve(["recipe"], available), guidance).toThrow(/requires "conformance-harness"/);
    expect(resolve(["recipe", "conformance-harness"], available).map((p) => p.name), guidance).toEqual([
      "recipe",
      "conformance-harness",
    ]);
  });
});

/**
 * Conformance: Layer 2 packages target a stack and apply only when the repo
 * declares it (D15 — a stack appears only when its Layer 2 recipes are wanted),
 * mirroring the requires/conflicts composition rule. The two Node packages are
 * the prior art the Python/React stacks mirror, so their emit shape is pinned:
 * `provides` drives emit for layer2 exactly as for layer1, and their path-scoped
 * `rules.md` frontmatter survives the emit verbatim.
 */
describe("conformance: Layer 2 stack packages", () => {
  it("refuses a stack-targeting package the manifest does not declare", () => {
    const guidance = [
      `A Layer 2 package applied to a repo that did not declare its stack. A stack-specific`,
      `recipe is only valid when praxis.yaml lists that stack in 'stacks' (D15) — otherwise`,
      `it is config nothing wants. Check the stack composition rule in resolve() (src/packages.ts).`,
    ].join("\n");
    const recipe = pkg("react-recipes", { layer: "layer2", stack: "react" });
    const available = new Map([[recipe.name, recipe]]);
    expect(() => resolve(["react-recipes"], available, []), guidance).toThrow(/"react" stack/);
    expect(() => resolve(["react-recipes"], available, ["python-backend"]), guidance).toThrow(/"react" stack/);
    expect(resolve(["react-recipes"], available, ["react"]).map((p) => p.name), guidance).toEqual(["react-recipes"]);
  });

  it("emits the Node packages as path-scoped owned rules when the node stack is declared", () => {
    const guidance = [
      `The Node Layer 2 packages did not emit as path-scoped owned rules. A layer2 rules-only`,
      `package must emit exactly like a layer1 one (provides drives emit), and its rules.md`,
      `'paths:' frontmatter must reach .claude/rules/praxis-<pkg>.md verbatim. Mirror`,
      `packages/layer2/node-recipes/ and check loadPackageSource/renderForTarget in src/emit.ts.`,
    ].join("\n");
    const ops = planEmit(manifest(["node-recipes", "node-testing"], ["claude-code"], ["node"]));
    const recipesOp = ops.find((o) => o.kind === "owned" && o.path === ".claude/rules/praxis-node-recipes.md");
    expect(recipesOp, guidance).toBeDefined();
    expect(recipesOp?.kind === "owned" && recipesOp.content.startsWith("---\npaths:"), guidance).toBe(true);
    // rules-only: no settings/permission op leaks from a layer2 package.
    expect(ops.some((o) => o.kind === "settings" && o.rules), guidance).toBe(false);
  });

  it("fails loudly when a Node package is selected without declaring the node stack", () => {
    const guidance = [
      `A Node Layer 2 package was selected but the node stack was not declared, and emit did`,
      `not fail. planEmit must pass manifest.stacks to resolvePackages so the stack rule fires.`,
      `Check resolvePackages(manifest.packages, manifest.stacks ?? []) in src/emit.ts.`,
    ].join("\n");
    expect(() => planEmit(manifest(["node-recipes"], ["claude-code"])), guidance).toThrow(/"node" stack/);
  });
});

/**
 * Conformance: the `onboarding` hook is a declared `package.yaml` field (D36).
 * The schema accepts valid hooks and rejects malformed ones (missing required fields).
 * This mirrors the existing schema validation tests in test/packages.test.ts but at
 * the conformance layer so the contract is CI-gated.
 */
describe("conformance: onboarding hook schema (D36)", () => {
  it("parsePackageManifest accepts a valid onboarding hook", () => {
    const guidance = [
      `A valid onboarding hook was rejected by parsePackageManifest. The schema must accept`,
      `an optional 'onboarding: { command, summary }' field. Check packageManifestSchema`,
      `in src/packages.ts — add the onboarding field as z.strictObject({command, summary}).optional().`,
    ].join("\n");
    const yaml = [
      "name: a",
      "layer: layer1",
      "provides: [rules]",
      "onboarding:",
      "  command: praxis-wiki",
      '  summary: "Seed the knowledge wiki."',
    ].join("\n");
    const result = parsePackageManifest(yaml, "a");
    expect(result.onboarding, guidance).toEqual({
      command: "praxis-wiki",
      summary: "Seed the knowledge wiki.",
    });
  });

  it("parsePackageManifest rejects an onboarding hook missing the command field", () => {
    const guidance = [
      `An onboarding hook missing the 'command' field was accepted. The schema must require`,
      `both 'command' and 'summary' inside onboarding. Check packageManifestSchema`,
      `in src/packages.ts — both fields must be z.string().min(1).`,
    ].join("\n");
    const yaml = [
      "name: a",
      "layer: layer1",
      "provides: [rules]",
      "onboarding:",
      '  summary: "No command field."',
    ].join("\n");
    expect(() => parsePackageManifest(yaml, "a"), guidance).toThrow(/command/);
  });

  it("parsePackageManifest accepts a package.yaml without an onboarding hook (optional)", () => {
    const guidance = [
      `A package.yaml without 'onboarding' was rejected. The field must be optional`,
      `so existing packages without a lifecycle hook continue to validate.`,
      `Check packageManifestSchema in src/packages.ts — onboarding must be .optional().`,
    ].join("\n");
    const yaml = "name: a\nlayer: layer1\nprovides: [rules]\n";
    const result = parsePackageManifest(yaml, "a");
    expect(result.onboarding, guidance).toBeUndefined();
  });
});
