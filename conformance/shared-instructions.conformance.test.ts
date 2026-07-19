import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reconcile } from "../src/program.js";
import { SHARED_PROJECT_BEGIN, SHARED_PROJECT_END } from "../src/shared-instructions.js";
import { runSync } from "../src/sync.js";

const MANIFEST = `
version: 1
methodology: "0.1.0"
targets: [claude-code, codex]
packages: [karpathy-claude]
`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), "praxis-shared-conformance-"));
  dirs.push(cwd);
  writeFileSync(join(cwd, "praxis.yaml"), MANIFEST, "utf8");
  runSync({ cwd, write: true });
  return cwd;
}

function block(content: string): string {
  return `${SHARED_PROJECT_BEGIN}\n${content}\n${SHARED_PROJECT_END}\n`;
}

describe("conformance: peer-native shared project instructions", () => {
  it("check accepts synchronized project facts and ignores target-specific prose", () => {
    const cwd = project();
    const shared = block("# Working in this repo\n\n- npm test");
    writeFileSync(join(cwd, "CLAUDE.md"), `${shared}\nClaude-specific.\n`, "utf8");
    const agents = readFileSync(join(cwd, "AGENTS.md"), "utf8");
    writeFileSync(join(cwd, "AGENTS.md"), `Codex-specific.\n\n${shared}\n${agents}`, "utf8");

    const result = reconcile(cwd, false, "check");
    expect(result.exitCode).toBe(0);
    expect(result.sharedInstructionReport?.status).toBe("synchronized");
  });

  it("check fails on parity drift and sync never chooses a project-owned winner", () => {
    const cwd = project();
    writeFileSync(join(cwd, "CLAUDE.md"), block("# Project\n\n- npm test"), "utf8");
    const agentsPath = join(cwd, "AGENTS.md");
    const managed = readFileSync(agentsPath, "utf8");
    writeFileSync(agentsPath, `${block("# Project\n\n- npm run test")}\n${managed}`, "utf8");
    const before = readFileSync(agentsPath, "utf8");

    const check = reconcile(cwd, false, "check");
    expect(check.exitCode).toBe(1);
    expect(check.sharedInstructionReport?.status).toBe("mismatch");

    runSync({ cwd, write: true });
    expect(readFileSync(agentsPath, "utf8")).toBe(before);
  });
});
