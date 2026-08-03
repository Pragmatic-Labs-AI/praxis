import { describe, expect, it } from "vitest";
import { planEmit } from "../src/emit.js";
import type { Manifest } from "../src/manifest.js";
import { praxisVersion } from "../src/version.js";
import { currentMethodology } from "../test/helpers.js";

/**
 * Conformance: emitted methodology names a **pinned** CLI invocation, never
 * `@latest` and never a bare `npx` (D59/D60).
 *
 * Two 0.3.0 bugs, one root:
 *   1. `praxis-upkeep` told agents to fall back to
 *      `npx @pragmatic-labs/praxis@latest check`, while `praxis-upgrade` says
 *      `methodology:` must equal the running CLI exactly. Both cannot hold. On a
 *      repo pinned to an older release, the upkeep fallback fetches a CLI that
 *      `check`/`sync` then refuse — routine maintenance breaks the moment a new
 *      version ships. (The refusal itself is correct and already enforced by
 *      `resolveMethodology`; see methodology-pin.conformance.test.ts. Nothing
 *      silently upgrades — it simply stops working.)
 *   2. Nothing in the always-loaded layer named the package at all, so an agent
 *      on a machine without the binary had no path from "run `praxis check`" to
 *      a command that runs.
 *
 * Both are fixed by the same mechanism: `{{methodology}}` in package sources,
 * substituted at emit time by `renderNeutralSyntax` (src/emit.ts). Emit time is
 * the only place that can know the value, which is why this could not be fixed
 * in a consumer repo.
 */

const MANIFEST: Manifest = {
  version: 1,
  methodology: currentMethodology(),
  targets: ["claude-code", "codex", "agents-md"],
  packages: ["karpathy-claude", "upkeep", "capture-codebase-patterns"],
};

/** Every piece of text this manifest would write to disk. */
function emittedText(manifest: Manifest = MANIFEST): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  for (const op of planEmit(manifest)) {
    if (op.kind === "owned") out.push({ path: op.path, text: op.content });
    else if (op.kind === "block") {
      for (const [id, body] of Object.entries(op.blocks)) {
        out.push({ path: `${op.path} [${id}]`, text: body });
      }
    }
  }
  return out;
}

describe("conformance: emitted CLI invocation is pinned", () => {
  it("never ships a floating-tag CLI invocation", () => {
    const guidance = [
      `An emitted file tells the agent to run a floating-tag Praxis invocation. That contradicts the`,
      `methodology pin: \`methodology:\` must equal the running CLI exactly (pre-1.0), so once a newer`,
      `version publishes, the floating tag fetches a CLI that \`check\` and \`sync\` refuse to run —`,
      `breaking routine upkeep on every pinned repo. Use \`@{{methodology}}\` in the package source`,
      `(packages/**/*.md), including \`allowed-tools\` frontmatter; renderNeutralSyntax in`,
      `src/emit.ts substitutes the running version at emit time.`,
      ``,
      `Only a runnable spec is forbidden — prose warning against floating tags by name is fine and`,
      `is why this asserts on the package spec rather than the bare tag.`,
    ].join("\n");
    // `@next`/`@canary` included: any dist-tag has the same failure mode.
    const floating = /@pragmatic-labs\/praxis@(latest|next|canary)\b/;
    for (const { path, text } of emittedText()) {
      expect(text, `${guidance}\nOffending file: ${path}`).not.toMatch(floating);
    }
  });

  it("never ships a bare, unpinned `npx @pragmatic-labs/praxis` invocation", () => {
    const guidance = [
      `An emitted file invokes \`npx @pragmatic-labs/praxis\` with no version. npx resolves that`,
      `through its own cache, so it can silently reuse a stale build (D40/D60) — a green run gives`,
      `no guarantee the next one uses the same CLI. Pin it: \`npx @pragmatic-labs/praxis@{{methodology}}\`.`,
    ].join("\n");
    // An actual invocation carries a subcommand; that is what separates it from
    // prose naming the bare form in order to warn against it.
    const bare = /npx\s+@pragmatic-labs\/praxis\s+(check|sync)\b/;
    for (const { path, text } of emittedText()) {
      expect(text, `${guidance}\nOffending file: ${path}`).not.toMatch(bare);
    }
  });

  it("leaves no unsubstituted {{methodology}} placeholder", () => {
    const guidance = [
      `An emitted file still contains a literal {{methodology}}. The placeholder must be resolved by`,
      `renderNeutralSyntax (src/emit.ts) on every path that renders package source — owned rules,`,
      `Claude commands, Codex skills, and AGENTS.md blocks. A leaked placeholder is worse than`,
      `\`@latest\`: the command is not runnable at all.`,
    ].join("\n");
    for (const { path, text } of emittedText()) {
      expect(text, `${guidance}\nOffending file: ${path}`).not.toContain("{{methodology}}");
    }
  });

  it("names the package and the pinned version where it tells the agent to run the CLI", () => {
    const guidance = [
      `The emitted upkeep rule says to run \`praxis check\` but never names the package, so an agent`,
      `on a machine without the binary cannot work out the invocation: bare \`praxis\` is`,
      `"command not found" and \`npx --no-install praxis\` gives npm's unhelpful "could not determine`,
      `executable to run". The always-loaded rule must carry the resolvable, pinned form. See`,
      `packages/layer1/upkeep/rules.md.`,
    ].join("\n");
    const rule = emittedText().find((f) => f.path.endsWith("praxis-upkeep.md"));
    expect(rule, guidance).toBeDefined();
    expect(rule!.text, guidance).toContain(`npx @pragmatic-labs/praxis@${praxisVersion()}`);
  });

  it("substitutes the same version the methodology pin is enforced against", () => {
    const guidance = [
      `The version emitted into methodology prose must be the one resolveMethodology enforces`,
      `(src/methodology.ts) — otherwise the emitted fallback names a CLI the repo's own pin`,
      `rejects. Both must come from praxisVersion() in src/version.ts; do not introduce a second`,
      `source for "what version is this".`,
    ].join("\n");
    const joined = emittedText().map((f) => f.text).join("\n");
    expect(joined, guidance).toContain(`@pragmatic-labs/praxis@${MANIFEST.methodology}`);
    expect(MANIFEST.methodology, guidance).toBe(praxisVersion());
  });
});
