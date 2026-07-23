import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planEmit } from "../src/emit.js";
import type { Manifest } from "../src/manifest.js";
import { runSync } from "../src/sync.js";
import { currentMethodology } from "../test/helpers.js";

/**
 * Conformance: consumer-repo safety (D54). Every write,
 * delete, or content-read Praxis performs against a target repo must stay
 * within the canonical repo root (or, for a project-local package's own
 * artifacts, within that package's own directory) — a literal "../" or a
 * symlink planted anywhere in the chain must never redirect Praxis outside
 * its approved root. Praxis has no trust override for an escaping path yet;
 * refusal (a hard, agent-readable error) is the default.
 *
 * Mirrors conformance/local-packages.conformance.test.ts and
 * conformance/prune.conformance.test.ts for fixture/temp-dir style. Symlink
 * semantics here are POSIX/ubuntu-CI only (Windows out of scope per the WS5
 * handoff).
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function manifest(packages: string[], targets: Manifest["targets"] = ["claude-code"]): Manifest {
  return { version: 1, methodology: currentMethodology(), targets, packages };
}

describe("conformance: path/symlink containment (consumer-repo safety, D54)", () => {
  it("attack 1 — refuses to write a managed file through a symlinked parent directory that escapes the repo root", () => {
    const repo = tempDir("praxis-containment-repo-");
    const outside = tempDir("praxis-containment-outside-");

    // A checked-in symlink is enough: `.claude` inside the repo actually
    // points somewhere else entirely. sync must never follow it to write
    // Praxis-managed content into `outside`.
    symlinkSync(outside, join(repo, ".claude"), "dir");
    writeFileSync(
      join(repo, "praxis.yaml"),
      ['version: 1', `methodology: "${currentMethodology()}"`, "targets: [claude-code]", "packages: [karpathy-claude]", ""].join(
        "\n",
      ),
      "utf8",
    );

    const guidance = [
      `A pre-existing symlink at ".claude" (or any managed-file ancestor) that resolves`,
      `outside the repo root must make sync refuse the write, not silently follow the`,
      `symlink and write outside the repo. Canonicalize every managed-file path against`,
      `the repo root before mkdirSync/writeFileSync in applyManifest (src/sync.ts) — see`,
      `resolveContained in src/path-safety.ts.`,
    ].join("\n");

    expect(() => runSync({ cwd: repo, write: true }), guidance).toThrow(/escapes the approved root/);
    expect(readdirSync(outside), guidance).toEqual([]);
  });

  it("attack 2a — rejects a project-local package path that escapes the repo root via ../, naming the offending path", () => {
    const repo = tempDir("praxis-containment-repo-");
    const outside = tempDir("praxis-containment-outside-");
    // name must match the directory's basename (parsePackageManifest's own
    // rule) so this test proves the containment escape itself, not a
    // coincidental rejection from the unrelated name/dirname check.
    writeFileSync(
      join(outside, "package.yaml"),
      `name: ${basename(outside)}\nlayer: local\nprovides: [rules]\n`,
      "utf8",
    );
    writeFileSync(join(outside, "rules.md"), "Escaped project-local content.\n", "utf8");

    // `outside` and `repo` are siblings under the same tmp root (both made via
    // mkdtempSync(tmpdir())), so this is a genuine "../<sibling>" escape — no
    // symlink needed, just a manifest entry naming a path outside the repo.
    const entry = `../${basename(outside)}`;

    const guidance = [
      `A project-local package entry ("./"- or "../"-prefixed praxis.yaml packages entry)`,
      `whose resolved directory lies outside the repo root must be a hard, loud error`,
      `naming the entry — not a silently-loaded package (D54: keep package roots`,
      `inside the repo; no trust override for an escaping path exists, so refuse).`,
      `Canonicalize in loadLocalPackage`,
      `(src/packages.ts) via resolveContained (src/path-safety.ts).`,
    ].join("\n");

    expect(() => planEmit(manifest([entry]), repo), guidance).toThrow(/escapes the approved root/);
    expect(() => planEmit(manifest([entry]), repo), guidance).toThrow(new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("attack 2b — rejects a project-local package path that is a symlink resolving outside the repo root", () => {
    const repo = tempDir("praxis-containment-repo-");
    const outside = tempDir("praxis-containment-outside-");
    writeFileSync(join(outside, "package.yaml"), "name: local-demo\nlayer: local\nprovides: [rules]\n", "utf8");
    writeFileSync(join(outside, "rules.md"), "Escaped project-local content.\n", "utf8");

    mkdirSync(join(repo, "praxis/packages"), { recursive: true });
    symlinkSync(outside, join(repo, "praxis/packages/local-demo"), "dir");

    const guidance = [
      `A project-local package path that lexically stays inside the repo but is itself`,
      `a symlink to somewhere outside must be rejected too — a lexical "./" prefix is`,
      `not proof of containment once symlinks are in play. Resolve with realpath`,
      `(resolveContained in src/path-safety.ts) before ever reading the local`,
      `package.yaml, in loadLocalPackage (src/packages.ts).`,
    ].join("\n");

    expect(
      () => planEmit(manifest(["./praxis/packages/local-demo"]), repo),
      guidance,
    ).toThrow(/escapes the approved root/);
  });

  it("attack 3 — does not read through a symlinked rules.md that escapes a project-local package's own directory", () => {
    const repo = tempDir("praxis-containment-repo-");
    const outside = tempDir("praxis-containment-outside-");
    writeFileSync(join(outside, "secret.md"), "EXTERNAL SECRET CONTENT, not methodology.\n", "utf8");

    const pkgDir = join(repo, "praxis/packages/local-demo");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.yaml"), "name: local-demo\nlayer: local\nprovides: [rules]\n", "utf8");
    symlinkSync(join(outside, "secret.md"), join(pkgDir, "rules.md"));

    const guidance = [
      `A project-local package directory containing a symlinked artifact (rules.md,`,
      `commands/*.md, ...) pointing outside its own directory must not be read through`,
      `into arbitrary external files — emit must refuse, and must never embed that`,
      `content into an emitted output file. Canonicalize in loadPackageSource`,
      `(src/emit.ts) via resolveContained (src/path-safety.ts), rooted at the`,
      `package's own directory.`,
    ].join("\n");

    expect(() => planEmit(manifest(["./praxis/packages/local-demo"]), repo), guidance).toThrow(
      /escapes the approved root/,
    );
  });

  // Attacks 3b–3e: the same D54 read-containment as attack 3, applied to the
  // sibling package-artifact loaders. loadPackageSource guards rules.md;
  // commands/, each command file, permissions.yaml, and plugins.yaml must be
  // guarded identically — these loaders run eagerly from planEmit, i.e. even
  // under a read-only `praxis check`.
  // `provides` must declare the attacked artifact — the loaders only run for
  // packages that declare them, which an attacker-authored package.yaml does.
  function localPkgFixture(provides: string): { repo: string; outside: string; pkgDir: string } {
    const repo = tempDir("praxis-containment-repo-");
    const outside = tempDir("praxis-containment-outside-");
    const pkgDir = join(repo, "praxis/packages/local-demo");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.yaml"), `name: local-demo\nlayer: local\nprovides: [rules, ${provides}]\n`, "utf8");
    writeFileSync(join(pkgDir, "rules.md"), "## Local demo\n\nLegitimate guidance.\n", "utf8");
    return { repo, outside, pkgDir };
  }

  it("attack 3b — does not read through a symlinked commands/ directory that escapes the package's own directory", () => {
    const { repo, outside, pkgDir } = localPkgFixture("commands");
    mkdirSync(join(outside, "cmds"));
    writeFileSync(join(outside, "cmds/leak.md"), "EXTERNAL SECRET CONTENT, not methodology.\n", "utf8");
    symlinkSync(join(outside, "cmds"), join(pkgDir, "commands"), "dir");

    const guidance = [
      `A project-local package whose commands/ directory is a symlink resolving outside`,
      `the package's own directory must not have its (real) files read through and`,
      `emitted into the consumer repo. A per-entry isFile() filter does not close this:`,
      `readdirSync resolves the dir symlink and the real files inside report`,
      `isFile() === true. Canonicalize the commands dir itself in loadCommandSources`,
      `(src/emit.ts) via resolveContained (src/path-safety.ts), rooted at the package dir.`,
    ].join("\n");

    expect(() => planEmit(manifest(["./praxis/packages/local-demo"]), repo), guidance).toThrow(
      /escapes the approved root/,
    );
  });

  it("attack 3c — never emits content from a symlinked command file inside a real commands/ directory", () => {
    const { repo, outside, pkgDir } = localPkgFixture("commands");
    writeFileSync(join(outside, "secret.md"), "EXTERNAL SECRET CONTENT, not methodology.\n", "utf8");
    mkdirSync(join(pkgDir, "commands"));
    writeFileSync(join(pkgDir, "commands/legit.md"), "Legitimate command content.\n", "utf8");
    symlinkSync(join(outside, "secret.md"), join(pkgDir, "commands/innocent.md"));

    const guidance = [
      `A symlinked command file inside a legitimate commands/ directory must never have`,
      `its external content read through into the emit plan. Today the withFileTypes`,
      `dirent filter in loadCommandSources (src/emit.ts) excludes symlinks (a symlink`,
      `dirent is not isFile()), and the per-file resolveContained guard backs it up —`,
      `whichever mechanism, the external bytes must not appear in any emitted op.`,
    ].join("\n");

    const ops = planEmit(manifest(["./praxis/packages/local-demo"]), repo);
    expect(JSON.stringify(ops), guidance).not.toContain("EXTERNAL SECRET CONTENT");
    expect(JSON.stringify(ops), guidance).toContain("Legitimate command content.");
  });

  it("attack 3d — does not read through a symlinked permissions.yaml that escapes the package's own directory", () => {
    const { repo, outside, pkgDir } = localPkgFixture("permissions");
    writeFileSync(join(outside, "external-permissions.yaml"), "allow: []\n", "utf8");
    symlinkSync(join(outside, "external-permissions.yaml"), join(pkgDir, "permissions.yaml"));

    const guidance = [
      `A symlinked permissions.yaml resolving outside the package's own directory must`,
      `not be read through — same containment as rules.md. Canonicalize in loadPolicy`,
      `(src/permissions.ts) via resolveContained (src/path-safety.ts).`,
    ].join("\n");

    expect(() => planEmit(manifest(["./praxis/packages/local-demo"]), repo), guidance).toThrow(
      /escapes the approved root/,
    );
  });

  it("attack 3e — does not read through a symlinked plugins.yaml that escapes the package's own directory", () => {
    const { repo, outside, pkgDir } = localPkgFixture("plugins");
    writeFileSync(join(outside, "external-plugins.yaml"), "plugins: []\n", "utf8");
    symlinkSync(join(outside, "external-plugins.yaml"), join(pkgDir, "plugins.yaml"));

    const guidance = [
      `A symlinked plugins.yaml resolving outside the package's own directory must`,
      `not be read through — same containment as rules.md. Canonicalize in`,
      `loadPluginsBlock (src/plugins.ts) via resolveContained (src/path-safety.ts).`,
    ].join("\n");

    expect(() => planEmit(manifest(["./praxis/packages/local-demo"]), repo), guidance).toThrow(
      /escapes the approved root/,
    );
  });

  it("attack 4 — refuses to delete an owned file that resolves outside the repo root via a symlinked owned directory", () => {
    const repo = tempDir("praxis-containment-repo-");
    const outside = tempDir("praxis-containment-outside-");
    writeFileSync(join(outside, "praxis-ghost.md"), "not actually Praxis's file to delete\n", "utf8");

    mkdirSync(join(repo, ".claude"), { recursive: true });
    symlinkSync(outside, join(repo, ".claude/rules"), "dir");

    // No rules-providing package selected, so `.claude/rules/praxis-ghost.md`
    // looks like an orphan the current manifest no longer implies — exactly
    // the prune path (findOwnedOrphans, src/sync.ts).
    writeFileSync(
      join(repo, "praxis.yaml"),
      ['version: 1', `methodology: "${currentMethodology()}"`, "targets: [claude-code]", "packages: [safe-permissions]", ""].join(
        "\n",
      ),
      "utf8",
    );

    const guidance = [
      `A managed-file record (here: prune's "owned orphan" scan) that resolves outside`,
      `the repo root via a symlinked ownership directory (.claude/rules, .claude/commands,`,
      `.codex/rules, .agents/skills) must refuse the deletion, not follow the symlink and`,
      `delete/unlink a file outside the repo. Canonicalize in findOwnedOrphans and the`,
      `orphan-deletion loop (src/sync.ts) via resolveContained (src/path-safety.ts).`,
    ].join("\n");

    expect(() => runSync({ cwd: repo, write: true }), guidance).toThrow(/escapes the approved root/);
    expect(existsSync(join(outside, "praxis-ghost.md")), guidance).toBe(true);
  });

  it("attack 5 (positive control) — legitimate layouts (plain repo + in-repo project-local package) still sync with no false rejections", () => {
    const repo = tempDir("praxis-containment-repo-");
    mkdirSync(join(repo, "praxis/packages/local-demo"), { recursive: true });
    writeFileSync(
      join(repo, "praxis/packages/local-demo/package.yaml"),
      "name: local-demo\nlayer: local\nprovides: [rules]\n",
      "utf8",
    );
    writeFileSync(join(repo, "praxis/packages/local-demo/rules.md"), "## Local demo\n\nLegitimate guidance.\n", "utf8");
    writeFileSync(
      join(repo, "praxis.yaml"),
      [
        "version: 1",
        `methodology: "${currentMethodology()}"`,
        "targets: [claude-code]",
        "packages: [karpathy-claude, ./praxis/packages/local-demo]",
        "",
      ].join("\n"),
      "utf8",
    );

    const guidance = [
      `Containment enforcement must not reject a legitimate, fully-in-repo layout: a`,
      `normal shipped-package rules file and an in-repo project-local package both`,
      `must still sync cleanly. If this fails after adding containment checks, the`,
      `check is too strict — it must only reject a path that canonicalizes OUTSIDE`,
      `the root, never a path that merely nests deeply inside it.`,
    ].join("\n");

    const report = runSync({ cwd: repo, write: true });
    expect(report.changed, guidance).toBe(true);
    expect(existsSync(join(repo, ".claude/rules/praxis-karpathy-claude.md")), guidance).toBe(true);
    expect(existsSync(join(repo, ".claude/rules/praxis-local-demo.md")), guidance).toBe(true);

    const second = runSync({ cwd: repo, write: true });
    expect(second.changed, "a second sync of an already-converged legitimate repo must be a no-op").toBe(false);
  });
});
