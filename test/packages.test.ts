import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  availablePackages,
  isLocalPackagePath,
  loadLocalPackage,
  parsePackageManifest,
  resolve,
  type ResolvedPackage,
} from "../src/packages.js";

function pkg(name: string, extra: Partial<ResolvedPackage> = {}): ResolvedPackage {
  return {
    name,
    layer: "layer1",
    provides: ["rules"],
    requires: [],
    conflicts: [],
    dir: `/x/${name}`,
    ...extra,
  };
}

function avail(...pkgs: ResolvedPackage[]): Map<string, ResolvedPackage> {
  return new Map(pkgs.map((p) => [p.name, p]));
}

describe("package loader", () => {
  it("discovers installed packages with their declared provides", () => {
    const all = availablePackages();
    expect(all.get("karpathy-claude")?.provides).toEqual(["rules"]);
    expect(all.get("safe-permissions")?.provides).toEqual(["permissions"]);
    expect(all.get("ponytail")?.provides).toEqual(["plugins"]);
    expect(all.get("ponytail")?.layer).toBe("external");
  });

  it("validates a package.yaml and enforces name == directory", () => {
    const ok = parsePackageManifest("name: a\nlayer: layer1\nprovides: [rules]\n", "a");
    expect(ok.name).toBe("a");
    expect(() =>
      parsePackageManifest("name: a\nlayer: layer1\nprovides: [rules]\n", "b"),
    ).toThrow(/match its directory/);
    expect(() =>
      parsePackageManifest("name: a\nlayer: nope\nprovides: [rules]\n", "a"),
    ).toThrow(/layer/);
  });

  it("resolves a valid selection in order", () => {
    const a = pkg("a");
    const b = pkg("b");
    expect(resolve(["a", "b"], avail(a, b))).toEqual([a, b]);
  });

  it("rejects an unknown package", () => {
    expect(() => resolve(["ghost"], avail(pkg("a")))).toThrow(/no such package/);
  });

  it("errors when a requires is not also selected", () => {
    const a = pkg("a", { requires: ["b"] });
    expect(() => resolve(["a"], avail(a, pkg("b")))).toThrow(/requires "b"/);
  });

  it("passes when a requires is also selected", () => {
    const a = pkg("a", { requires: ["b"] });
    expect(resolve(["a", "b"], avail(a, pkg("b"))).map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("rejects conflicting packages selected together", () => {
    const a = pkg("a", { conflicts: ["b"] });
    expect(() => resolve(["a", "b"], avail(a, pkg("b")))).toThrow(/conflict/);
  });
});

describe("workspace pseudo-stack gate (D53)", () => {
  it("accepts stack: workspace in package.yaml", () => {
    const manifest = parsePackageManifest("name: a\nlayer: layer2\nprovides: [rules]\nstack: workspace\n", "a");
    expect(manifest.stack).toBe("workspace");
  });

  it("refuses a workspace-stack package when declaredStacks omits it, with the workspace-specific message", () => {
    const a = pkg("a", { stack: "workspace" });
    expect(() => resolve(["a"], avail(a))).toThrow(/add a `workspace:` section to praxis\.yaml, or remove the package/i);
  });

  it("accepts a workspace-stack package when declaredStacks includes it", () => {
    const a = pkg("a", { stack: "workspace" });
    expect(resolve(["a"], avail(a), ["workspace"]).map((p) => p.name)).toEqual(["a"]);
  });
});

describe("project-local packages", () => {
  it("isLocalPackagePath recognizes ./ and ../ prefixes, rejects a bare name", () => {
    expect(isLocalPackagePath("./praxis/packages/onboarding")).toBe(true);
    expect(isLocalPackagePath("../shared/packages/onboarding")).toBe(true);
    expect(isLocalPackagePath("karpathy-claude")).toBe(false);
  });

  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function tempRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "praxis-local-pkg-"));
    dirs.push(dir);
    return dir;
  }

  function writeLocalPackage(cwd: string, relDir: string, yaml: string): void {
    const dir = join(cwd, relDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.yaml"), yaml, "utf8");
  }

  it("loadLocalPackage resolves a valid local package (happy path)", () => {
    const cwd = tempRepo();
    writeLocalPackage(cwd, "praxis/packages/onboarding", "name: onboarding\nlayer: local\nprovides: [rules]\n");
    const pkg = loadLocalPackage("./praxis/packages/onboarding", cwd);
    expect(pkg.name).toBe("onboarding");
    expect(pkg.layer).toBe("local");
    expect(pkg.dir).toBe(join(cwd, "praxis/packages/onboarding"));
  });

  it("loadLocalPackage errors when no package.yaml exists at the path", () => {
    const cwd = tempRepo();
    expect(() => loadLocalPackage("./praxis/packages/missing", cwd)).toThrow(
      /praxis\.yaml lists local package "\.\/praxis\/packages\/missing" but no package\.yaml exists at that path/,
    );
  });

  it("loadLocalPackage rejects a local package that does not declare layer: local", () => {
    const cwd = tempRepo();
    writeLocalPackage(cwd, "praxis/packages/onboarding", "name: onboarding\nlayer: layer1\nprovides: [rules]\n");
    expect(() => loadLocalPackage("./praxis/packages/onboarding", cwd)).toThrow(/layer: local/);
  });

  it("loadLocalPackage rejects a package.yaml whose name does not match its directory", () => {
    const cwd = tempRepo();
    writeLocalPackage(cwd, "praxis/packages/onboarding", "name: wrong-name\nlayer: local\nprovides: [rules]\n");
    expect(() => loadLocalPackage("./praxis/packages/onboarding", cwd)).toThrow(/match its directory/);
  });
});
