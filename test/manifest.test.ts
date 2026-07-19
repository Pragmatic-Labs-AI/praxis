import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadWorkspaceConfig, parseManifest } from "../src/manifest.js";

const VALID = `
version: 1
methodology: "0.1.0"
stacks: [python-backend, node]
targets: [claude-code, agents-md]
packages:
  - karpathy-claude
  - conformance-harness
`;

describe("manifest", () => {
  it("parses a valid praxis.yaml", () => {
    const m = parseManifest(VALID);
    expect(m).toEqual({
      version: 1,
      methodology: "0.1.0",
      stacks: ["python-backend", "node"],
      targets: ["claude-code", "agents-md"],
      packages: ["karpathy-claude", "conformance-harness"],
    });
  });

  it("rejects an unknown target, naming the field", () => {
    const bad = VALID.replace("agents-md", "smoke-signals");
    expect(() => parseManifest(bad)).toThrow(/targets/);
  });

  it("rejects an unknown stack", () => {
    const bad = VALID.replace("python-backend", "cobol-mainframe");
    expect(() => parseManifest(bad)).toThrow(/stacks/);
  });

  it("accepts a stack-less, Layer-1-only manifest", () => {
    const m = parseManifest(`
version: 1
methodology: "0.1.0"
targets: [agents-md]
packages: [karpathy-claude]
`);
    expect(m.stacks).toBeUndefined();
    expect(m.packages).toEqual(["karpathy-claude"]);
  });

  it("accepts codex without changing existing manifest requirements", () => {
    const m = parseManifest(`
version: 1
methodology: "0.1.0"
targets: [codex]
packages: [karpathy-claude]
`);
    expect(m.targets).toEqual(["codex"]);
  });

  it("reports a missing required field", () => {
    const bad = VALID.replace(/methodology: .*/, "");
    expect(() => parseManifest(bad)).toThrow(/methodology/);
  });

  it("rejects an empty packages list", () => {
    const bad = VALID.replace(/packages:[\s\S]*$/, "packages: []\n");
    expect(() => parseManifest(bad)).toThrow(/packages/);
  });

  it("throws a readable error on malformed YAML", () => {
    expect(() => parseManifest("packages: [unclosed")).toThrow(/not valid YAML/);
  });
});

describe("manifest workspace section (D53)", () => {
  const BASE = `
version: 1
methodology: "0.1.0"
targets: [claude-code]
packages: [karpathy-claude]
`;

  it("accepts a workspace section with members and edges", () => {
    const m = parseManifest(
      `${BASE}workspace:
  members:
    - path: node-api
    - path: frontend
      name: web
  edges:
    - from: node-api
      to: web
      contract: docs/wiki/contracts/node-api-to-web.md
`,
    );
    expect(m.workspace).toEqual({
      members: [{ path: "node-api" }, { path: "frontend", name: "web" }],
      edges: [{ from: "node-api", to: "web", contract: "docs/wiki/contracts/node-api-to-web.md" }],
    });
  });

  it("strict-rejects an unknown workspace key", () => {
    expect(() =>
      parseManifest(
        `${BASE}workspace:
  members:
    - path: node-api
  bogus: true
`,
      ),
    ).toThrow(/workspace/);
  });

  it("rejects an absolute member path", () => {
    expect(() =>
      parseManifest(
        `${BASE}workspace:
  members:
    - path: /etc/node-api
`,
      ),
    ).toThrow(/repo-relative/);
  });

  it("rejects a member path with a '..' segment", () => {
    expect(() =>
      parseManifest(
        `${BASE}workspace:
  members:
    - path: ../outside
`,
      ),
    ).toThrow(/repo-relative/);
  });

  it("rejects nested/overlapping member paths", () => {
    expect(() =>
      parseManifest(
        `${BASE}workspace:
  members:
    - path: a
    - path: a/b
`,
      ),
    ).toThrow(/overlaps/);
  });

  it("rejects an edge naming an undeclared member", () => {
    expect(() =>
      parseManifest(
        `${BASE}workspace:
  members:
    - path: node-api
  edges:
    - from: node-api
      to: ghost
`,
      ),
    ).toThrow(/undeclared member/);
  });

  it("rejects duplicate member names", () => {
    expect(() =>
      parseManifest(
        `${BASE}workspace:
  members:
    - path: node-api
      name: shared
    - path: frontend
      name: shared
`,
      ),
    ).toThrow(/duplicate member name/);
  });

  it("rejects 'workspace' declared in stacks", () => {
    expect(() =>
      parseManifest(
        `
version: 1
methodology: "0.1.0"
stacks: [workspace]
targets: [claude-code]
packages: [karpathy-claude]
`,
      ),
    ).toThrow(/stacks/);
  });
});

describe("loadWorkspaceConfig (lenient reader)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function tempRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "praxis-workspace-cfg-"));
    dirs.push(dir);
    return dir;
  }

  it("returns undefined when praxis.yaml is missing", () => {
    expect(loadWorkspaceConfig(tempRepo())).toBeUndefined();
  });

  it("returns undefined on broken YAML", () => {
    const cwd = tempRepo();
    writeFileSync(join(cwd, "praxis.yaml"), "packages: [unclosed", "utf8");
    expect(loadWorkspaceConfig(cwd)).toBeUndefined();
  });

  it("returns undefined when there is no workspace section", () => {
    const cwd = tempRepo();
    writeFileSync(
      join(cwd, "praxis.yaml"),
      'version: 1\nmethodology: "0.1.0"\ntargets: [claude-code]\npackages: [karpathy-claude]\n',
      "utf8",
    );
    expect(loadWorkspaceConfig(cwd)).toBeUndefined();
  });

  it("returns the workspace config when the section is present and valid", () => {
    const cwd = tempRepo();
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(cwd, "praxis.yaml"),
      [
        "version: 1",
        'methodology: "0.1.0"',
        "targets: [claude-code]",
        "packages: [karpathy-claude]",
        "workspace:",
        "  members:",
        "    - path: node-api",
        "",
      ].join("\n"),
      "utf8",
    );
    expect(loadWorkspaceConfig(cwd)).toEqual({ members: [{ path: "node-api" }], edges: [] });
  });
});
