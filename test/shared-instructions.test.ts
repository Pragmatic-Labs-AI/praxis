import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Manifest } from "../src/manifest.js";
import {
  SHARED_PROJECT_BEGIN,
  SHARED_PROJECT_END,
  checkSharedInstructions,
} from "../src/shared-instructions.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-shared-instructions-"));
  dirs.push(dir);
  return dir;
}

function manifest(targets: Manifest["targets"]): Manifest {
  return { version: 1, methodology: "0.1.0", targets, packages: [] };
}

function block(content: string, lineEnding = "\n"): string {
  return [SHARED_PROJECT_BEGIN, content, SHARED_PROJECT_END, ""].join(lineEnding);
}

describe("shared project instructions", () => {
  it("does not require parity without both first-class targets", () => {
    expect(checkSharedInstructions(tempDir(), manifest(["claude-code", "agents-md"]))).toMatchObject({
      status: "not-required",
      ok: true,
    });
  });

  it("defers parity while first-run onboarding is pending", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, ".praxis-setup-pending"), "pending\n", "utf8");
    expect(checkSharedInstructions(cwd, manifest(["claude-code", "codex"]))).toMatchObject({
      status: "pending-onboarding",
      ok: true,
    });
  });

  it("requires one shared block in each native file", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "CLAUDE.md"), block("# Project"), "utf8");
    const report = checkSharedInstructions(cwd, manifest(["claude-code", "codex"]));
    expect(report.status).toBe("missing");
    expect(report.diagnostics).toContain("AGENTS.md: missing project-owned praxis:shared-project block");
  });

  it("accepts identical blocks while ignoring target-specific surrounding prose", () => {
    const cwd = tempDir();
    const shared = block("# Project\n\n- npm test");
    writeFileSync(join(cwd, "CLAUDE.md"), `${shared}\nClaude-only guidance.\n`, "utf8");
    writeFileSync(join(cwd, "AGENTS.md"), `Codex-only guidance.\n\n${shared}`, "utf8");
    expect(checkSharedInstructions(cwd, manifest(["claude-code", "codex"]))).toMatchObject({
      status: "synchronized",
      ok: true,
    });
  });

  it("normalizes line endings but otherwise reports exact-content drift", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "CLAUDE.md"), block("# Project\n\n- npm test"), "utf8");
    writeFileSync(join(cwd, "AGENTS.md"), block("# Project\r\n\r\n- npm test", "\r\n"), "utf8");
    expect(checkSharedInstructions(cwd, manifest(["claude-code", "codex"])).ok).toBe(true);

    writeFileSync(join(cwd, "AGENTS.md"), block("# Project\n\n- npm run test"), "utf8");
    expect(checkSharedInstructions(cwd, manifest(["claude-code", "codex"]))).toMatchObject({
      status: "mismatch",
      ok: false,
    });
  });

  it("rejects duplicate shared blocks", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "CLAUDE.md"), `${block("one")}\n${block("two")}`, "utf8");
    writeFileSync(join(cwd, "AGENTS.md"), block("one"), "utf8");
    expect(checkSharedInstructions(cwd, manifest(["claude-code", "codex"])).diagnostics).toContain(
      "CLAUDE.md: expected one praxis:shared-project block, found 2",
    );
  });
});
