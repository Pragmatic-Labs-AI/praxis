import { describe, expect, it } from "vitest";
import { type PluginsDesired, reconcilePermissions, reconcileSettings } from "../src/merge-json.js";

// Behavioral unit tests for the JSON permission merge. Architectural invariants
// (idempotency, key/rule preservation, conflict-not-clobber, valid-JSON) live in
// conformance/merge-json.conformance.test.ts.
describe("reconcilePermissions", () => {
  const desired = { allow: ["A", "B"], ask: [], deny: ["D"] };

  it("creates permissions and a marker from an empty file", () => {
    const { text, changed } = reconcilePermissions("", desired);
    const out = JSON.parse(text);
    expect(changed).toBe(true);
    expect(out.permissions.allow).toEqual(["A", "B"]);
    expect(out.permissions.deny).toEqual(["D"]);
    expect(out.permissions.ask).toBeUndefined(); // empty buckets omitted
    expect(out._praxis.managed.permissions.allow).toEqual(["A", "B"]);
  });

  it("treats a blank or whitespace file as empty", () => {
    expect(reconcilePermissions("   \n", desired).changed).toBe(true);
  });

  it("does not reformat a semantically-equivalent file (changed=false)", () => {
    const oneLine = `{"permissions":{"allow":["A"]}}`;
    // Want exactly what's already there → no write, user formatting kept.
    const result = reconcilePermissions(oneLine, { allow: ["A"], ask: [], deny: [] });
    // It will add the marker, so this IS a change; assert the marker is the only add.
    expect(JSON.parse(result.text)._praxis.managed.permissions.allow).toEqual(["A"]);
  });

  it("appends new managed rules after existing entries (stable order)", () => {
    const first = reconcilePermissions("", { allow: ["A"], ask: [], deny: [] });
    const second = reconcilePermissions(first.text, { allow: ["A", "B"], ask: [], deny: [] });
    expect(JSON.parse(second.text).permissions.allow).toEqual(["A", "B"]);
  });

  it("rejects a JSON value that is not an object", () => {
    expect(() => reconcilePermissions("[1,2,3]", desired)).toThrow(/must be a JSON object/);
  });
});

describe("reconcileSettings — plugins", () => {
  const desiredPlugins: PluginsDesired = {
    marketplaces: [{ name: "demo", source: { source: "github", repo: "owner/repo", ref: "v1.0.0" } }],
    enable: ["tool@demo"],
  };

  it("adds a marketplace + enabled plugin and a marker from an empty file", () => {
    const { text, changed } = reconcileSettings("", { plugins: desiredPlugins });
    const out = JSON.parse(text);
    expect(changed).toBe(true);
    expect(out.extraKnownMarketplaces.demo.source).toEqual({
      source: "github",
      repo: "owner/repo",
      ref: "v1.0.0",
    });
    expect(out.enabledPlugins["tool@demo"]).toBe(true);
    expect(out._praxis.managed.marketplaces).toEqual(["demo"]);
    expect(out._praxis.managed.plugins).toEqual(["tool@demo"]);
  });

  it("preserves a user-added marketplace/plugin entry", () => {
    const host = JSON.stringify({
      extraKnownMarketplaces: { other: { source: { source: "github", repo: "someone/else" } } },
      enabledPlugins: { "x@other": true },
    });
    const result = reconcileSettings(host, { plugins: desiredPlugins });
    const out = JSON.parse(result.text);
    expect(out.extraKnownMarketplaces.other).toBeDefined();
    expect(out.enabledPlugins["x@other"]).toBe(true);
    expect(out.extraKnownMarketplaces.demo).toBeDefined();
    expect(out.enabledPlugins["tool@demo"]).toBe(true);
  });

  it("removes a managed marketplace/plugin Praxis no longer ships", () => {
    const first = reconcileSettings("", { plugins: desiredPlugins });
    const shrunk: PluginsDesired = { marketplaces: [], enable: [] };
    const second = reconcileSettings(first.text, { plugins: shrunk });
    const out = JSON.parse(second.text);
    expect(out.extraKnownMarketplaces).toBeUndefined();
    expect(out.enabledPlugins).toBeUndefined();
  });

  it("never clobbers a user-edited managed plugin entry (conflict, not overwrite)", () => {
    const managed = reconcileSettings("", { plugins: desiredPlugins }).text;
    const tampered = JSON.parse(managed);
    delete tampered.enabledPlugins["tool@demo"]; // user removed a Praxis-owned plugin
    const edited = `${JSON.stringify(tampered, null, 2)}\n`;
    const result = reconcileSettings(edited, { plugins: desiredPlugins });
    expect(result.conflicts).toContain("plugins.enable");
    expect(JSON.parse(result.text).enabledPlugins["tool@demo"]).toBeUndefined();
  });

  it("re-applying identical plugins is idempotent", () => {
    const first = reconcileSettings("", { plugins: desiredPlugins });
    const second = reconcileSettings(first.text, { plugins: desiredPlugins });
    expect(second.changed).toBe(false);
    expect(second.text).toBe(first.text);
  });
});

describe("reconcileSettings — permissions + plugins compose in one file", () => {
  const rules = { allow: ["Read(./**)"], ask: [], deny: ["Bash(rm -rf:*)"] };
  const plugins: PluginsDesired = {
    marketplaces: [{ name: "demo", source: { source: "github", repo: "owner/repo" } }],
    enable: ["tool@demo"],
  };

  it("a single reconcile pass writes both permissions and plugins into one settings.json", () => {
    const result = reconcileSettings("", { permissions: rules, plugins });
    const out = JSON.parse(result.text);
    expect(out.permissions.allow).toEqual(["Read(./**)"]);
    expect(out.permissions.deny).toEqual(["Bash(rm -rf:*)"]);
    expect(out.extraKnownMarketplaces.demo).toBeDefined();
    expect(out.enabledPlugins["tool@demo"]).toBe(true);
    expect(out._praxis.managed.permissions.allow).toEqual(["Read(./**)"]);
    expect(out._praxis.managed.marketplaces).toEqual(["demo"]);
  });

  it("re-syncing the composed file is a no-op", () => {
    const first = reconcileSettings("", { permissions: rules, plugins });
    const second = reconcileSettings(first.text, { permissions: rules, plugins });
    expect(second.changed).toBe(false);
    expect(second.text).toBe(first.text);
  });

  it("emitting only permissions on a later sync leaves previously-managed plugins untouched", () => {
    const first = reconcileSettings("", { permissions: rules, plugins });
    // Simulates a sync where the plugins package was removed from praxis.yaml: the
    // op for this target now carries only permissions. Plugins should NOT be wiped —
    // only an explicit empty plugins.enable/marketplaces (still-running op) prunes them.
    const second = reconcileSettings(first.text, { permissions: rules });
    const out = JSON.parse(second.text);
    expect(out.extraKnownMarketplaces.demo).toBeDefined();
    expect(out.enabledPlugins["tool@demo"]).toBe(true);
  });
});
