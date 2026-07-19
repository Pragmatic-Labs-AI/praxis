import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSync } from "../src/sync.js";

const MANIFEST = `
version: 1
methodology: "0.1.0"
stacks: [python-backend]
targets: [claude-code, agents-md]
packages: [karpathy-claude]
`;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempProject(manifest: string | null = MANIFEST): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-test-"));
  dirs.push(dir);
  if (manifest !== null) writeFileSync(join(dir, "praxis.yaml"), manifest, "utf8");
  return dir;
}

const RULE = ".claude/rules/praxis-karpathy-claude.md";

describe("runSync", () => {
  it("creates the owned rule file and the AGENTS.md block", () => {
    const dir = tempProject();
    const report = runSync({ cwd: dir, write: true });
    expect(report.changed).toBe(true);
    expect(existsSync(join(dir, RULE))).toBe(true);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toMatch(/praxis:begin karpathy-claude/);
  });

  it("check writes nothing but reports drift", () => {
    const dir = tempProject();
    const report = runSync({ cwd: dir, write: false });
    expect(report.changed).toBe(true);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  });

  it("after sync, check reports no drift", () => {
    const dir = tempProject();
    runSync({ cwd: dir, write: true });
    const report = runSync({ cwd: dir, write: false });
    expect(report.changed).toBe(false);
    expect(report.files.every((f) => f.status === "unchanged")).toBe(true);
  });

  it("throws a readable error when praxis.yaml is missing", () => {
    const dir = tempProject(null);
    expect(() => runSync({ cwd: dir, write: true })).toThrow(/No praxis\.yaml/);
  });
});
