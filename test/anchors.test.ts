import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkAnchors, parseAnchorsFromMarkdown } from "../src/anchors.js";
import type { Workspace } from "../src/manifest.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-anchors-"));
  dirs.push(dir);
  return dir;
}

function write(cwd: string, path: string, text: string): void {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), text, "utf8");
}

describe("knowledge anchors", () => {
  it("parses praxisAnchors frontmatter", () => {
    const parsed = parseAnchorsFromMarkdown(
      "docs/wiki/index.md",
      `---
praxisAnchors:
  - type: path
    target: src/sync.ts
---
# Index
`,
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.anchors).toEqual([{ type: "path", target: "src/sync.ts" }]);
  });

  it("parses frontmatter with CRLF line endings (Windows checkouts)", () => {
    const lf = `---
praxisAnchors:
  - type: path
    target: src/sync.ts
---
# Index
`;
    const parsed = parseAnchorsFromMarkdown("docs/wiki/index.md", lf.replace(/\n/g, "\r\n"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.anchors).toEqual([{ type: "path", target: "src/sync.ts" }]);
  });

  it("parses frontmatter behind a UTF-8 BOM", () => {
    const parsed = parseAnchorsFromMarkdown(
      "docs/wiki/index.md",
      `﻿---
praxisAnchors:
  - type: path
    target: src/sync.ts
---
# Index
`,
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.anchors).toEqual([{ type: "path", target: "src/sync.ts" }]);
  });

  it("resolves path, command, and section anchors", () => {
    const cwd = tempProject();
    write(cwd, "src/sync.ts", "export {}\n");
    write(cwd, "package.json", JSON.stringify({ scripts: { selfcheck: "praxis check" } }));
    write(cwd, "docs/ARCHITECTURE.md", "## 11. Decision record\n");
    write(
      cwd,
      "docs/wiki/index.md",
      `---
praxisAnchors:
  - type: path
    target: src/sync.ts
  - type: command
    target: npm run selfcheck
  - type: section
    target: docs/ARCHITECTURE.md#11-decision-record
---
# Index
`,
    );

    expect(checkAnchors(cwd)).toMatchObject({
      anchorsChecked: 3,
      diagnostics: [],
      ok: true,
    });
  });

  it("reports broken anchors without guessing at prose truth", () => {
    const cwd = tempProject();
    write(cwd, "package.json", JSON.stringify({ scripts: { test: "vitest" } }));
    write(
      cwd,
      "docs/wiki/index.md",
      `---
praxisAnchors:
  - type: path
    target: src/missing.ts
  - type: command
    target: npm run selfcheck
---
# Index
`,
    );

    const report = checkAnchors(cwd);
    expect(report.ok).toBe(false);
    expect(report.diagnostics.map((d) => d.message)).toEqual([
      "path does not exist: src/missing.ts",
      'package.json has no "selfcheck" script',
    ]);
  });
});

describe("workspace member anchors (D53)", () => {
  function workspaceWith(memberPath: string, memberName?: string): Workspace {
    return {
      members: [{ path: memberPath, ...(memberName ? { name: memberName } : {}) }],
      edges: [],
    };
  }

  it("resolves path, command, and section anchors against a cloned member dir", () => {
    const cwd = tempProject();
    write(cwd, "repo-c/.git/HEAD", "ref: refs/heads/main\n");
    write(cwd, "repo-c/src/lib.ts", "export {}\n");
    write(cwd, "repo-c/package.json", JSON.stringify({ scripts: { test: "vitest" } }));
    write(cwd, "repo-c/docs/README.md", "## Setup\n");
    write(
      cwd,
      "docs/wiki/index.md",
      `---
praxisAnchors:
  - type: path
    target: src/lib.ts
    member: repo-c
  - type: command
    target: npm run test
    member: repo-c
  - type: section
    target: docs/README.md#setup
    member: repo-c
---
# Index
`,
    );

    const report = checkAnchors(cwd, workspaceWith("repo-c"));
    expect(report).toMatchObject({ anchorsChecked: 3, diagnostics: [], skipped: [], ok: true });
  });

  it("skips (advisory) a declared-but-missing member, ok stays true", () => {
    const cwd = tempProject();
    write(
      cwd,
      "docs/wiki/index.md",
      `---
praxisAnchors:
  - type: path
    target: src/lib.ts
    member: repo-c
---
# Index
`,
    );

    const report = checkAnchors(cwd, workspaceWith("repo-c"));
    expect(report.ok).toBe(true);
    expect(report.anchorsChecked).toBe(0);
    expect(report.skipped).toEqual([
      { file: "docs/wiki/index.md", member: "repo-c", target: "src/lib.ts", reason: 'member "repo-c" not cloned' },
    ]);
  });

  it("skips (advisory) a member dir that exists without a .git entry", () => {
    const cwd = tempProject();
    write(cwd, "repo-c/src/lib.ts", "export {}\n"); // mkdir'd, never cloned
    write(
      cwd,
      "docs/wiki/index.md",
      `---
praxisAnchors:
  - type: path
    target: src/lib.ts
    member: repo-c
---
# Index
`,
    );

    const report = checkAnchors(cwd, workspaceWith("repo-c"));
    expect(report.ok).toBe(true);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]?.reason).toBe('member "repo-c" not cloned');
  });

  it("hard-fails on an anchor naming an undeclared member", () => {
    const cwd = tempProject();
    write(
      cwd,
      "docs/wiki/index.md",
      `---
praxisAnchors:
  - type: path
    target: src/lib.ts
    member: ghost
---
# Index
`,
    );

    const report = checkAnchors(cwd, workspaceWith("repo-c"));
    expect(report.ok).toBe(false);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]?.message).toMatch(/undeclared member "ghost"|does not declare/);
  });

  it("hard-fails on a member: anchor when no workspace is declared", () => {
    const cwd = tempProject();
    write(
      cwd,
      "docs/wiki/index.md",
      `---
praxisAnchors:
  - type: path
    target: src/lib.ts
    member: repo-c
---
# Index
`,
    );

    const report = checkAnchors(cwd); // no workspace arg
    expect(report.ok).toBe(false);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]?.message).toMatch(/declares no workspace/);
  });

  it("plain anchors behave byte-identically with and without a workspace arg", () => {
    const cwd = tempProject();
    write(cwd, "src/sync.ts", "export {}\n");
    write(
      cwd,
      "docs/wiki/index.md",
      `---
praxisAnchors:
  - type: path
    target: src/sync.ts
---
# Index
`,
    );

    const withoutWorkspace = checkAnchors(cwd);
    const withWorkspace = checkAnchors(cwd, workspaceWith("repo-c"));
    expect(withWorkspace).toEqual(withoutWorkspace);
    expect(withoutWorkspace).toMatchObject({ anchorsChecked: 1, diagnostics: [], skipped: [], ok: true });
  });
});
