import { describe, expect, it } from "vitest";
import { planEmit } from "../src/emit.js";
import type { Manifest } from "../src/manifest.js";
import { resolve, type ResolvedPackage } from "../src/packages.js";

/**
 * Conformance: the React Layer 2 stack packages apply only when the manifest
 * declares the `react` stack (D15), and emit path-scoped owned rules exactly
 * as the Node packages do — verifying that the Layer 2 mechanism works for a
 * second stack without modification (docs/wiki/packages-and-emit.md).
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

describe("conformance: Layer 2 React stack packages", () => {
  it("refuses a react-stack package when the manifest does not declare the react stack", () => {
    const guidance = [
      `A React Layer 2 package applied to a repo that did not declare the react stack.`,
      `A stack-specific recipe is only valid when praxis.yaml lists that stack in 'stacks'`,
      `(D15) — otherwise it is config nothing wants. resolve() must throw naming the`,
      `"react" stack when stacks is [] or omits react. Check the stack composition rule`,
      `in resolve() (src/packages.ts).`,
    ].join("\n");
    const reactPkg = pkg("react-components", { layer: "layer2", stack: "react" });
    const available = new Map([[reactPkg.name, reactPkg]]);
    expect(() => resolve(["react-components"], available, []), guidance).toThrow(/"react" stack/);
    expect(() => resolve(["react-components"], available, ["node"]), guidance).toThrow(/"react" stack/);
    expect(
      resolve(["react-components"], available, ["react"]).map((p) => p.name),
      guidance,
    ).toEqual(["react-components"]);
  });

  it("emits the React packages as path-scoped owned rules when the react stack is declared", () => {
    const guidance = [
      `The React Layer 2 packages did not emit as path-scoped owned rules. A layer2`,
      `rules-only package must emit exactly like a layer1 one (provides drives emit),`,
      `and its rules.md 'paths:' frontmatter must reach .claude/rules/praxis-<pkg>.md`,
      `verbatim. Mirror packages/layer2/react-components/ and check`,
      `loadPackageSource/renderForTarget in src/emit.ts.`,
    ].join("\n");
    const ops = planEmit(manifest(["react-components", "react-testing"], ["claude-code"], ["react"]));
    const componentsOp = ops.find(
      (o) => o.kind === "owned" && o.path === ".claude/rules/praxis-react-components.md",
    );
    expect(componentsOp, guidance).toBeDefined();
    expect(
      componentsOp?.kind === "owned" && componentsOp.content.startsWith("---\npaths:"),
      guidance,
    ).toBe(true);
    // rules-only: no settings/permission op leaks from a layer2 package.
    expect(ops.some((o) => o.kind === "settings" && o.rules), guidance).toBe(false);
  });

  it("fails loudly when a React package is selected without declaring the react stack", () => {
    const guidance = [
      `A React Layer 2 package was selected but the react stack was not declared, and`,
      `emit did not fail. planEmit must pass manifest.stacks to resolvePackages so the`,
      `stack rule fires. Check resolvePackages(manifest.packages, manifest.stacks ?? [])`,
      `in src/emit.ts.`,
    ].join("\n");
    expect(() => planEmit(manifest(["react-components"], ["claude-code"])), guidance).toThrow(/"react" stack/);
  });
});
