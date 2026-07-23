import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import type { Manifest } from "../src/manifest.js";
import { applyManifest } from "../src/sync.js";
import { currentMethodology } from "../test/helpers.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-codex-conformance-"));
  dirs.push(dir);
  return dir;
}

const MANIFEST: Manifest = {
  version: 1,
  methodology: currentMethodology(),
  stacks: ["node"],
  targets: ["codex", "agents-md"],
  packages: [
    "karpathy-claude",
    "instruction-upkeep",
    "node-recipes",
    "safe-permissions",
    "ponytail",
    "drawio",
  ],
};

describe("conformance: first-class Codex emit", () => {
  it("installs every supported Codex surface once and reaches a second-run fixed point", () => {
    const dir = tempProject();
    const first = applyManifest(MANIFEST, dir, true);
    expect(first.hasConflicts).toBe(false);
    expect(first.files.filter((file) => file.path === "AGENTS.md")).toHaveLength(1);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("Applies only when working on files matching");
    expect(existsSync(join(dir, ".agents/skills/praxis-instructions/SKILL.md"))).toBe(true);
    expect(readFileSync(join(dir, ".codex/config.toml"), "utf8")).toContain('extends = ":workspace"');
    expect(existsSync(join(dir, ".codex/rules/praxis-safe-permissions.rules"))).toBe(true);
    const marketplace = JSON.parse(readFileSync(join(dir, ".agents/plugins/marketplace.json"), "utf8"));
    expect(marketplace.plugins.map((plugin: { name: string }) => plugin.name)).toEqual(["ponytail"]);
    expect(existsSync(join(dir, ".praxis/codex-marketplace-state.json"))).toBe(true);

    const second = applyManifest(MANIFEST, dir, false);
    expect(second.changed).toBe(false);
    expect(second.hasConflicts).toBe(false);
  });

  it("prunes only Praxis-owned Codex skills when a command package is removed", () => {
    const dir = tempProject();
    applyManifest(MANIFEST, dir, true);
    const reduced: Manifest = { ...MANIFEST, packages: MANIFEST.packages.filter((pkg) => pkg !== "instruction-upkeep") };
    const report = applyManifest(reduced, dir, true);
    expect(report.files).toContainEqual(expect.objectContaining({
      path: ".agents/skills/praxis-instructions/SKILL.md",
      status: "deleted",
    }));
  });

  it("still emits command rules when the permission-profile TOML conflicts", () => {
    const dir = tempProject();
    mkdirSync(join(dir, ".codex"), { recursive: true });
    writeFileSync(join(dir, ".codex/config.toml"), 'default_permissions = ":read-only"\n', "utf8");
    const report = applyManifest(MANIFEST, dir, true);
    expect(report.hasConflicts).toBe(true);
    expect(report.files.find((file) => file.path === ".codex/config.toml")?.conflicts).toContain(
      "default_permissions",
    );
    expect(existsSync(join(dir, ".codex/rules/praxis-safe-permissions.rules"))).toBe(true);
  });

  it("prunes the Codex profile block and rules file when safe-permissions is removed", () => {
    const dir = tempProject();
    applyManifest(MANIFEST, dir, true);
    const reduced: Manifest = { ...MANIFEST, packages: MANIFEST.packages.filter((pkg) => pkg !== "safe-permissions") };
    const report = applyManifest(reduced, dir, true);
    expect(report.files).toContainEqual(expect.objectContaining({
      path: ".codex/rules/praxis-safe-permissions.rules",
      status: "deleted",
    }));
    expect(readFileSync(join(dir, ".codex/config.toml"), "utf8")).not.toContain("praxis:begin");
  });

  it("prunes the orphaned ownership sidecar when marketplace.json is deleted by hand after codex is dropped", () => {
    const dir = tempProject();
    applyManifest(MANIFEST, dir, true);
    expect(existsSync(join(dir, ".praxis/codex-marketplace-state.json"))).toBe(true);
    // codex leaves the plan (e.g. removed from targets) — planEmit no longer
    // reconciles marketplace.json, so the removal sweep is the only path left.
    rmSync(join(dir, ".agents/plugins/marketplace.json"));
    const withoutCodex: Manifest = { ...MANIFEST, targets: ["agents-md"] };
    const report = applyManifest(withoutCodex, dir, true);
    expect(report.files).toContainEqual(expect.objectContaining({
      path: ".praxis/codex-marketplace-state.json",
      status: "deleted",
    }));
    expect(existsSync(join(dir, ".praxis/codex-marketplace-state.json"))).toBe(false);
  });

  const codexAvailable = (process.env.PATH ?? "").split(delimiter).some((dir) => existsSync(join(dir, "codex")));
  it.skipIf(!codexAvailable)("passes representative commands through codex execpolicy check", () => {
    const dir = tempProject();
    applyManifest(MANIFEST, dir, true);
    const rules = join(dir, ".codex/rules/praxis-safe-permissions.rules");
    const result = spawnSync("codex", [
      "execpolicy", "check", "--rules", rules, "--", "git", "push", "--force", "origin", "main",
    ], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("forbidden");
  });
});
