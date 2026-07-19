import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Conformance: public-snapshot fresh root (D56/D58). The `--git-init` root
 * commit is the public repository's first commit, so nothing about it may
 * inherit machine state: the branch must be `main` (CI only watches `main`;
 * a machine without `init.defaultBranch` would produce `master`), the
 * author/committer must be the pinned public Pragmatic Labs identity (never
 * global git config), and the commit must carry a DCO `Signed-off-by`
 * trailer so the public repo's sign-off gate holds from commit one.
 *
 * Mirrors conformance/path-containment.conformance.test.ts for temp-dir
 * style; runs the real script against the real repo, like the selfcheck
 * gate treats the built CLI.
 */

const repoRoot = resolve(__dirname, "..");
const script = join(repoRoot, "scripts", "build-public-snapshot.mjs");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("conformance: public snapshot fresh root (D56/D58)", () => {
  // The builder lives in scripts/, which the public snapshot withholds by
  // omission — inside the public repo this test skips rather than fails,
  // mirroring conformance/codex.conformance.test.ts's absent-tool skip.
  it.skipIf(!existsSync(script))(
    "creates branch main with a signed-off root commit under the pinned public identity",
    () => {
      const out = join(tempDir("praxis-public-snapshot-"), "snapshot");
      execFileSync("node", [script, "--out", out, "--git-init"], {
        cwd: repoRoot,
        encoding: "utf8",
        // Machine config must not be able to leak in even when it disagrees:
        // simulate a hostile environment and assert the pinned values win.
        env: {
          ...process.env,
          GIT_CONFIG_COUNT: "3",
          GIT_CONFIG_KEY_0: "init.defaultBranch",
          GIT_CONFIG_VALUE_0: "trunk",
          GIT_CONFIG_KEY_1: "user.name",
          GIT_CONFIG_VALUE_1: "Wrong Identity",
          GIT_CONFIG_KEY_2: "user.email",
          GIT_CONFIG_VALUE_2: "wrong@client-domain.example",
        },
      });

      expect(git(out, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
      expect(git(out, ["log", "-1", "--format=%an <%ae>"])).toBe(
        "Pragmatic Labs <tony@pragmaticlabs.ai>",
      );
      expect(git(out, ["log", "-1", "--format=%cn <%ce>"])).toBe(
        "Pragmatic Labs <tony@pragmaticlabs.ai>",
      );
      expect(git(out, ["log", "-1", "--format=%B"])).toContain(
        "Signed-off-by: Pragmatic Labs <tony@pragmaticlabs.ai>",
      );
      // Exactly one commit — a fresh root, never carried-over history.
      expect(git(out, ["rev-list", "--count", "HEAD"])).toBe("1");
    },
  );
});
