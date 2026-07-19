import { describe, expect, it } from "vitest";
import { planEmit } from "../src/emit.js";
import type { Manifest } from "../src/manifest.js";
import { resolve, type ResolvedPackage } from "../src/packages.js";

/**
 * Conformance: the Python Layer 2 stack (`python-backend`) follows the same
 * stack-composition rule as Node (D15, D30): a stack-targeting package is
 * refused when the manifest does not declare it, and emits as a path-scoped
 * owned rule when it does. The two Python packages (`python-backend-recipes`,
 * `python-testing`) mirror the Node prior art
 * (packages/layer2/node-recipes/, packages/layer2/node-testing/).
 */

function manifest(
  packages: string[],
  targets: Manifest["targets"],
  stacks?: Manifest["stacks"],
): Manifest {
  return { version: 1, methodology: "0.1.0", targets, packages, ...(stacks ? { stacks } : {}) };
}

function pkg(name: string, extra: Partial<ResolvedPackage> = {}): ResolvedPackage {
  return { name, layer: "layer1", provides: ["rules"], requires: [], conflicts: [], dir: `/x/${name}`, ...extra };
}

describe("conformance: Layer 2 Python stack", () => {
  it("refuses a python-backend package when the manifest does not declare the python-backend stack", () => {
    const guidance = [
      `A python-backend Layer 2 package applied to a repo that did not declare the "python-backend" stack.`,
      `A stack-specific recipe is only valid when praxis.yaml lists that stack in 'stacks' (D15).`,
      `resolve() must throw naming the "python-backend" stack when stacks is [] or ["node"].`,
      `Mirror the stack composition rule in src/packages.ts and packages/layer2/node-recipes/.`,
    ].join("\n");
    const recipe = pkg("python-backend-recipes", { layer: "layer2", stack: "python-backend" });
    const available = new Map([[recipe.name, recipe]]);
    expect(() => resolve(["python-backend-recipes"], available, []), guidance).toThrow(/"python-backend" stack/);
    expect(() => resolve(["python-backend-recipes"], available, ["node"]), guidance).toThrow(/"python-backend" stack/);
    expect(
      resolve(["python-backend-recipes"], available, ["python-backend"]).map((p) => p.name),
      guidance,
    ).toEqual(["python-backend-recipes"]);
  });

  it("emits the Python packages as path-scoped owned rules when the python-backend stack is declared", () => {
    const guidance = [
      `The Python Layer 2 packages did not emit as path-scoped owned rules. A layer2 rules-only`,
      `package must emit exactly like a layer1 one (provides drives emit), and its rules.md`,
      `'paths:' frontmatter must reach .claude/rules/praxis-<pkg>.md verbatim. Mirror`,
      `packages/layer2/python-backend-recipes/ and check loadPackageSource/renderForTarget in src/emit.ts.`,
    ].join("\n");
    const ops = planEmit(
      manifest(["python-backend-recipes", "python-testing"], ["claude-code"], ["python-backend"]),
    );
    const recipesOp = ops.find(
      (o) => o.kind === "owned" && o.path === ".claude/rules/praxis-python-backend-recipes.md",
    );
    expect(recipesOp, guidance).toBeDefined();
    expect(recipesOp?.kind === "owned" && recipesOp.content.startsWith("---\npaths:"), guidance).toBe(true);
    // rules-only: no settings/permission op leaks from a layer2 package.
    expect(ops.some((o) => o.kind === "settings" && o.rules), guidance).toBe(false);
  });

  it("fails loudly when a python-backend package is selected without declaring the python-backend stack", () => {
    const guidance = [
      `A Python Layer 2 package was selected but the python-backend stack was not declared, and emit did`,
      `not fail. planEmit must pass manifest.stacks to resolvePackages so the stack rule fires.`,
      `Check resolvePackages(manifest.packages, manifest.stacks ?? []) in src/emit.ts.`,
    ].join("\n");
    expect(() => planEmit(manifest(["python-backend-recipes"], ["claude-code"])), guidance).toThrow(
      /"python-backend" stack/,
    );
  });
});
