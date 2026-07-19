import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planEmit } from "../src/emit.js";
import type { Manifest } from "../src/manifest.js";
import { runSync } from "../src/sync.js";

/**
 * Conformance: project-local packages (docs/wiki/packages-and-emit.md). A `./`-
 * or `../`-prefixed entry in `praxis.yaml`'s `packages:` list names a package
 * that lives in the TARGET repo rather than the tree Praxis ships — declared,
 * resolved, emitted, synced, and pruned exactly like a shipped package. The only
 * differences: it must declare `layer: local` (so provenance stays legible),
 * and its name must not collide with an already-available package.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-local-pkg-conf-"));
  dirs.push(dir);
  return dir;
}

function writeLocalPackage(cwd: string, relDir: string, yaml: string, rulesMd?: string): void {
  const dir = join(cwd, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.yaml"), yaml, "utf8");
  if (rulesMd !== undefined) writeFileSync(join(dir, "rules.md"), rulesMd, "utf8");
}

function manifest(packages: string[], targets: Manifest["targets"] = ["claude-code"]): Manifest {
  return { version: 1, methodology: "0.1.0", targets, packages };
}

describe("conformance: project-local packages", () => {
  it("resolves a ./ entry first-class: owned .claude/rules file + AGENTS.md block", () => {
    const cwd = tempRepo();
    writeLocalPackage(
      cwd,
      "praxis/packages/local-demo",
      "name: local-demo\nlayer: local\nprovides: [rules]\n",
      "## Local demo\n\nProject-local guidance, not shipped with Praxis.\n",
    );
    const guidance = [
      `A "./"-prefixed praxis.yaml packages entry must resolve exactly like a shipped`,
      `package: an owned .claude/rules/praxis-<name>.md file for claude-code and an`,
      `AGENTS.md block keyed <name> for agents-md. Check isLocalPackagePath/loadLocalPackage`,
      `in src/packages.ts and that planEmit()/resolvePackages() thread cwd through so`,
      `loadPackageSource(p.dir) finds the local package's rules.md.`,
    ].join("\n");

    const ops = planEmit(manifest(["./praxis/packages/local-demo"], ["claude-code", "agents-md"]), cwd);

    const owned = ops.find(
      (o) => o.kind === "owned" && o.target === "claude-code" && o.path === ".claude/rules/praxis-local-demo.md",
    );
    expect(owned, guidance).toBeDefined();
    expect(owned?.kind === "owned" && owned.content).toContain("Project-local guidance", );

    const block = ops.find((o) => o.kind === "block" && o.target === "agents-md");
    expect(block, guidance).toBeDefined();
    expect(block?.kind === "block" && Object.keys(block.blocks), guidance).toEqual(["local-demo"]);
  });

  it("fails loudly, naming the entry, when no package.yaml exists at the ./ path", () => {
    const cwd = tempRepo();
    const guidance = [
      `A praxis.yaml entry naming a local package path with no package.yaml at that path`,
      `must fail loud, naming the entry verbatim. Check loadLocalPackage() in src/packages.ts.`,
    ].join("\n");
    expect(() => planEmit(manifest(["./praxis/packages/missing"]), cwd), guidance).toThrow(
      /praxis\.yaml lists local package "\.\/praxis\/packages\/missing" but no package\.yaml exists at that path/,
    );
  });

  it("rejects a local package that does not declare layer: local", () => {
    const cwd = tempRepo();
    writeLocalPackage(
      cwd,
      "praxis/packages/local-demo",
      "name: local-demo\nlayer: layer1\nprovides: [rules]\n",
      "content\n",
    );
    const guidance = [
      `A project-local package (a "./"-prefixed praxis.yaml entry) must declare`,
      `layer: local so provenance (shipped vs. project-owned) stays legible without`,
      `cross-referencing praxis.yaml. Check loadLocalPackage() in src/packages.ts.`,
    ].join("\n");
    expect(() => planEmit(manifest(["./praxis/packages/local-demo"]), cwd), guidance).toThrow(/layer: local/);
  });

  it("rejects a local package.yaml whose name does not match its directory", () => {
    const cwd = tempRepo();
    writeLocalPackage(
      cwd,
      "praxis/packages/local-demo",
      "name: something-else\nlayer: local\nprovides: [rules]\n",
      "content\n",
    );
    const guidance = [
      `A local package.yaml's 'name' must equal its directory's basename — the same rule`,
      `parsePackageManifest() enforces for shipped packages (src/packages.ts).`,
    ].join("\n");
    expect(() => planEmit(manifest(["./praxis/packages/local-demo"]), cwd), guidance).toThrow(
      /match its directory/,
    );
  });

  it("fails loudly on a name collision with an already-installed (shipped) package", () => {
    const cwd = tempRepo();
    // "onboarding" is a shipped layer1 package name (packages/layer1/onboarding/).
    writeLocalPackage(
      cwd,
      "praxis/packages/onboarding",
      "name: onboarding\nlayer: local\nprovides: [rules]\n",
      "content\n",
    );
    const guidance = [
      `A local package whose declared name collides with an already-installed package`,
      `(shipped or an earlier local entry) must fail loud rather than silently shadow it.`,
      `Check the collision check in resolvePackages() (src/packages.ts).`,
    ].join("\n");
    expect(() => planEmit(manifest(["./praxis/packages/onboarding"]), cwd), guidance).toThrow(
      /Local package "\.\/praxis\/packages\/onboarding" collides with an already-installed package named "onboarding"/,
    );
  });

  it("emits, drifts, reconverges, and prunes through the sync apply path exactly like a shipped package", () => {
    const cwd = tempRepo();
    writeLocalPackage(
      cwd,
      "praxis/packages/local-demo",
      "name: local-demo\nlayer: local\nprovides: [rules]\n",
      "## Local demo\n\nOriginal project-local guidance.\n",
    );
    const manifestYaml = [
      "version: 1",
      'methodology: "0.1.0"',
      "targets: [claude-code]",
      "packages: [karpathy-claude, ./praxis/packages/local-demo]",
      "",
    ].join("\n");
    writeFileSync(join(cwd, "praxis.yaml"), manifestYaml, "utf8");

    const localRulePath = join(cwd, ".claude/rules/praxis-local-demo.md");
    const shippedRulePath = join(cwd, ".claude/rules/praxis-karpathy-claude.md");

    const guidance = [
      `A local package must participate in the full sync lifecycle exactly like a shipped`,
      `package: emit, drift-on-edit, reconverge-on-sync, and prune-on-removal. Prune`,
      `machinery (findOwnedOrphans in src/sync.ts) must stay unchanged — it works off`,
      `planEmit's owned-op paths, which now simply include local packages too.`,
    ].join("\n");

    // 1. Emit.
    const first = runSync({ cwd, write: true });
    expect(existsSync(localRulePath), guidance).toBe(true);
    expect(existsSync(shippedRulePath), guidance).toBe(true);
    expect(first.changed, guidance).toBe(true);

    // 2. Edit the emitted local rules artifact — check reports drift (owned files
    //    are placed wholesale, not merged, so any hand-edit is drift, not a conflict).
    writeFileSync(localRulePath, "## Local demo\n\nHAND-EDITED, not what the source says.\n", "utf8");
    const check = runSync({ cwd, write: false });
    const localFileReport = check.files.find((f) => f.path === ".claude/rules/praxis-local-demo.md");
    expect(localFileReport?.status, guidance).toBe("updated");
    expect(check.changed, guidance).toBe(true);

    // 3. Sync reconverges: the hand-edit is overwritten back to the local package's source.
    runSync({ cwd, write: true });
    expect(readFileSync(localRulePath, "utf8"), guidance).toContain("Original project-local guidance");

    // 4. Remove the ./ entry from the manifest — declarative absence, same as removing a
    //    shipped package name.
    writeFileSync(
      join(cwd, "praxis.yaml"),
      ['version: 1', 'methodology: "0.1.0"', "targets: [claude-code]", "packages: [karpathy-claude]", ""].join(
        "\n",
      ),
      "utf8",
    );
    const pruneReport = runSync({ cwd, write: true });
    expect(existsSync(localRulePath), guidance).toBe(false);
    expect(existsSync(shippedRulePath), guidance).toBe(true);
    expect(pruneReport.changed, guidance).toBe(true);

    // 5. Idempotent: a second sync after the prune is a no-op.
    const second = runSync({ cwd, write: true });
    expect(second.changed, "a second sync after pruning a removed local package must be a no-op").toBe(false);
  });

  it("a local package's onboarding hook appears in the spliced bootstrap-delegations list (D36 generality)", () => {
    const cwd = tempRepo();
    writeLocalPackage(
      cwd,
      "praxis/packages/local-demo",
      [
        "name: local-demo",
        "layer: local",
        "provides: [rules]",
        "onboarding:",
        "  command: local-demo-setup",
        '  summary: "Set up the project-local demo package."',
        "",
      ].join("\n"),
      "## Local demo\n\nGuidance.\n",
    );
    const guidance = [
      `The <!-- praxis:bootstrap-delegations --> splice in planEmit() (src/emit.ts) is`,
      `generic over every selected package that declares an 'onboarding' hook — it must`,
      `not special-case shipped packages. A local package's hook must appear in the`,
      `emitted .claude/commands/praxis-onboard.md exactly like a shipped package's would.`,
    ].join("\n");

    const ops = planEmit(manifest(["onboarding", "./praxis/packages/local-demo"], ["claude-code"]), cwd);
    const onboardOp = ops.find(
      (o) => o.kind === "owned" && o.target === "claude-code" && o.path === ".claude/commands/praxis-onboard.md",
    );
    expect(onboardOp, guidance).toBeDefined();
    expect(
      onboardOp?.kind === "owned" && onboardOp.content.includes("`/local-demo-setup` — Set up the project-local demo package."),
      guidance,
    ).toBe(true);
  });
});
