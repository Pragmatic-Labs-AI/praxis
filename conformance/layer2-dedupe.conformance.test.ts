import { describe, expect, it } from "vitest";
import { loadPackageSource } from "../src/emit.js";
import { availablePackages } from "../src/packages.js";

/**
 * Conformance: Layer 2 recipes defer to Layer 1 (`karpathy-claude`) for general
 * craft instead of restating it (docs/wiki/decisions.md D44; "link the canonical
 * source, restated facts drift" — CLAUDE.md's Instruction upkeep rule, applied to
 * the methodology content itself). A Layer 2 `rules.md` may apply a Layer 1
 * principle to something stack-specific, but must not restate the rule itself as
 * a bullet.
 *
 * Data-driven: this holds for EVERY layer2 package, so a new one is covered the
 * moment it ships its package.yaml — no test edit required (D24).
 */

const LAYER2_PACKAGES = [...availablePackages().values()]
  .filter((p) => p.layer === "layer2")
  .map((p) => p.name)
  .sort();

// A bullet opening with a Layer 1 rule title (packages/layer1/karpathy-claude/rules.md's
// four rule titles) is a restatement — Layer 2 recipes must defer to Layer 1 instead.
const LAYER1_RESTATEMENT = /^- \*\*(Think before coding|Simplicity first|Surgical changes?|Goal-driven)/m;

describe("conformance: Layer 2 defers to Layer 1 instead of restating it", () => {
  it("has at least one layer2 package to check", () => {
    const guidance = [
      `No package declares layer: layer2. This test is data-driven over layer2`,
      `packages (availablePackages()); if the Layer 2 stacks were removed, remove`,
      `this test too. Otherwise check package.yaml 'layer' fields.`,
    ].join("\n");
    expect(LAYER2_PACKAGES.length, guidance).toBeGreaterThan(0);
  });

  it.each(LAYER2_PACKAGES)("%s/rules.md does not restate a Layer 1 rule as a bullet", (pkg) => {
    const source = loadPackageSource(availablePackages().get(pkg)!.dir) ?? "";
    const match = source.match(LAYER1_RESTATEMENT);
    const title = match?.[1] ?? "";
    const guidance = [
      `${pkg}/rules.md restates Layer 1 rule '${title}'. Layer 2 recipes defer to`,
      `karpathy-claude for general craft — replace the bullet with the one-line`,
      `Layer 1 deference (see packages/layer2/node-recipes/rules.md) and keep only`,
      `stack-specific content.`,
    ].join("\n");
    expect(match, guidance).toBeNull();
  });
});

/**
 * Conformance: a Layer 2 bullet must be *stack-specific*. A bold bullet title
 * that appears in two packages of DIFFERENT stacks is generic craft with the
 * nouns swapped, not a stack-specific failure mode — it belongs in the file's
 * intro prose (or Layer 1), not as a bullet. Same-stack sharing (e.g.
 * node-recipes + node-testing) is fine: those are one stack's discipline split
 * across authoring and testing.
 *
 * Data-driven over every layer2 package's stack (package.yaml), so a new stack
 * or package is covered the moment it ships — no test edit required (D24).
 */

// Bold bullet title: `- **Title.**` → "title" (lowercased, trailing punctuation stripped).
const BULLET_TITLE = /^- \*\*(.+?)\*\*/gm;

function bulletTitles(source: string): string[] {
  return [...source.matchAll(BULLET_TITLE)].map((m) =>
    (m[1] ?? "").toLowerCase().replace(/[.:!?\s]+$/, "").trim(),
  );
}

describe("conformance: Layer 2 bullets are stack-specific, not generic craft", () => {
  // title -> stack -> the package that used it (first wins; enough to name the collision).
  const titleStacks = new Map<string, Map<string, string>>();
  for (const name of LAYER2_PACKAGES) {
    const pkg = availablePackages().get(name)!;
    const stack = pkg.stack ?? "(no stack)";
    const source = loadPackageSource(pkg.dir) ?? "";
    for (const title of bulletTitles(source)) {
      if (!title) continue;
      const byStack = titleStacks.get(title) ?? new Map<string, string>();
      if (!byStack.has(stack)) byStack.set(stack, name);
      titleStacks.set(title, byStack);
    }
  }

  const crossStack = [...titleStacks.entries()].filter(([, byStack]) => byStack.size > 1);

  it("no bullet title is shared across two different stacks", () => {
    const guidance = crossStack
      .map(([title, byStack]) => {
        const where = [...byStack.entries()].map(([s, p]) => `${p} (${s})`).join(" and ");
        return `Bullet "**${title}**" appears in ${where}. Cross-stack repetition means it is generic craft, not a stack-specific failure mode — move it into the file's intro prose (or Layer 1) and keep bullets stack-specific.`;
      })
      .join("\n");
    expect(crossStack, guidance).toEqual([]);
  });
});
