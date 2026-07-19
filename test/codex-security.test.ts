import { describe, expect, it } from "vitest";
import { codexCapabilityMode, reconcileCodexConfig, renderCodexRules } from "../src/codex-security.js";
import { availablePackages } from "../src/packages.js";
import { loadPolicy, policyCapabilities } from "../src/permissions.js";

/** Look up a shipped package's directory by name — loadPolicy is dir-based. */
function dirOf(pkg: string): string {
  return availablePackages().get(pkg)!.dir;
}

const safePermissionsPolicy = loadPolicy(dirOf("safe-permissions"))!;

describe("Codex security emitter", () => {
  it("creates, updates idempotently, and removes a hash-protected TOML block", () => {
    const first = reconcileCodexConfig("model = \"gpt-5\"\n", true);
    expect(first.conflicts).toEqual([]);
    expect(first.text).toContain('default_permissions = "praxis-safe-permissions"');
    expect(first.text).toContain('"**/*.pem" = "deny"');
    expect(first.text).toContain('"**/.env*" = "deny"');
    expect(first.text).toContain("enabled = false");
    expect(reconcileCodexConfig(first.text, true).changed).toBe(false);
    const removed = reconcileCodexConfig(first.text, false);
    expect(removed.text).toBe('model = "gpt-5"\n');
  });

  it.each([
    ['default_permissions = ":workspace"\n', "default_permissions"],
    ['sandbox_mode = "workspace-write"\n', "sandbox_mode"],
    ["[sandbox_workspace_write]\nnetwork_access = true\n", "sandbox_workspace_write"],
    ["[permissions.praxis-safe-permissions]\nextends = \":workspace\"\n", "permissions.praxis-safe-permissions"],
  ])("refuses conflicting project config: %s", (existing, conflict) => {
    const result = reconcileCodexConfig(existing, true);
    expect(result.changed).toBe(false);
    expect(result.conflicts).toContain(conflict);
  });

  it("keeps default_permissions in root scope when existing config ends inside a table", () => {
    const existing = '[tui]\ntheme = "dark"\n';
    const result = reconcileCodexConfig(existing, true);
    expect(result.conflicts).toEqual([]);
    // The managed block's bare key must precede any `[table]` header —
    // otherwise TOML would scope it under that table instead of root.
    expect(result.text.indexOf('default_permissions = "praxis-safe-permissions"')).toBeLessThan(
      result.text.indexOf("[tui]"),
    );
    const removed = reconcileCodexConfig(result.text, false);
    expect(removed.text).toBe(existing);
  });

  it("preserves a user-edited managed block as a conflict", () => {
    const first = reconcileCodexConfig("", true).text;
    const edited = first.replace("enabled = false", "enabled = true");
    const result = reconcileCodexConfig(edited, true);
    expect(result.text).toBe(edited);
    expect(result.conflicts).toEqual(["safe-permissions"]);
  });

  it("maps neutral command capabilities to all three Codex decisions", () => {
    const rules = renderCodexRules(safePermissionsPolicy);
    expect(rules).toContain('pattern = ["git", "status"], decision = "allow"');
    expect(rules).toContain('pattern = ["git", "push"], decision = "prompt"');
    expect(rules).toContain('pattern = ["git", "push", "--force"], decision = "forbidden"');
    expect(rules).toContain('pattern = ["rm", "-rf"], decision = "forbidden"');
  });

  it("has an explicit Codex behavior for every neutral capability", () => {
    for (const capability of policyCapabilities(safePermissionsPolicy)) {
      expect(codexCapabilityMode(capability), capability).toBeDefined();
    }
  });
});
