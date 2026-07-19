import { describe, expect, it } from "vitest";
import { availablePackages } from "../src/packages.js";
import { loadPluginsBlock, parsePluginsBlock } from "../src/plugins.js";

/** Look up a shipped package's directory by name — loadPluginsBlock is dir-based. */
function dirOf(pkg: string): string {
  return availablePackages().get(pkg)!.dir;
}

// Behavioral unit tests for the neutral plugins-block loader. The tool-neutrality /
// no-execution invariants live in conformance/plugins.conformance.test.ts.
describe("plugins block loader", () => {
  const VALID = [
    "targets: [claude-code]",
    "marketplace:",
    "  name: demo",
    "  source: { source: github, repo: owner/repo }",
    "enable: [tool@demo]",
    "",
  ].join("\n");

  it("parses a valid plugins block", () => {
    const block = parsePluginsBlock(VALID, "demo-pkg");
    expect(block.targets).toEqual(["claude-code"]);
    expect(block.marketplace.name).toBe("demo");
    expect(block.marketplace.source).toEqual({ source: "github", repo: "owner/repo" });
    expect(block.enable).toEqual(["tool@demo"]);
  });

  it("accepts an honest ref/sha pin", () => {
    const yaml = [
      "targets: [claude-code]",
      "marketplace:",
      "  name: demo",
      "  source: { source: github, repo: owner/repo, ref: v1.0.0, sha: abcdef1 }",
      "enable: [tool@demo]",
      "",
    ].join("\n");
    const block = parsePluginsBlock(yaml, "demo-pkg");
    expect(block.marketplace.source.ref).toBe("v1.0.0");
    expect(block.marketplace.source.sha).toBe("abcdef1");
  });

  it("parses verified Codex metadata with safe defaults", () => {
    const block = parsePluginsBlock(`${VALID}codex:\n  name: tool\n  category: Productivity\n`, "demo-pkg");
    expect(block.codex).toEqual({
      name: "tool",
      category: "Productivity",
      installation: "INSTALLED_BY_DEFAULT",
      authentication: "ON_INSTALL",
    });
  });

  it("rejects a missing block (required fields absent)", () => {
    expect(() => parsePluginsBlock("targets: [claude-code]\n", "demo-pkg")).toThrow(/invalid/);
  });

  it("rejects unknown top-level keys (strict contract)", () => {
    const yaml = `${VALID}\nextra: true\n`;
    expect(() => parsePluginsBlock(yaml, "demo-pkg")).toThrow(/invalid/);
  });

  it("rejects an enable entry whose @marketplace does not match (fail loud)", () => {
    const yaml = [
      "targets: [claude-code]",
      "marketplace:",
      "  name: demo",
      "  source: { source: github, repo: owner/repo }",
      "enable: [tool@other]",
      "",
    ].join("\n");
    expect(() => parsePluginsBlock(yaml, "demo-pkg")).toThrow(/must end in "@demo"/);
  });

  it("loads the shipped ponytail plugins.yaml", () => {
    const block = loadPluginsBlock(dirOf("ponytail"));
    expect(block).toBeDefined();
    expect(block!.marketplace.name).toBe("ponytail");
    expect(block!.enable).toContain("ponytail@ponytail");
    expect(block!.codex?.name).toBe("ponytail");
  });

  it("loads the shipped drawio plugins.yaml pinned to a full commit SHA (no tag upstream)", () => {
    const block = loadPluginsBlock(dirOf("drawio"));
    expect(block).toBeDefined();
    expect(block!.marketplace.source.ref).toMatch(/^[0-9a-f]{40}$/);
    expect(block!.marketplace.source.sha).toBeUndefined();
    expect(block!.codex).toBeUndefined();
  });

  it("returns undefined for a package with no plugins block", () => {
    expect(loadPluginsBlock(dirOf("karpathy-claude"))).toBeUndefined();
  });
});
