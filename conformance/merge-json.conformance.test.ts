import { describe, expect, it } from "vitest";
import { applyOp, planEmit } from "../src/emit.js";
import type { Manifest } from "../src/manifest.js";
import { type RuleSet, reconcilePermissions } from "../src/merge-json.js";

/**
 * Conformance: the JSON-aware permission merge upholds the same non-negotiables as
 * the markdown engine, in a comment-less format (docs/wiki/merge-engine.md, decisions
 * D10/D11/D18/D19). These invariants ARE the spec for structured-config merge.
 * Each failure message tells the agent what broke, where, and which decision
 * governs the fix (see conformance/README.md).
 */

const DESIRED: RuleSet = {
  allow: ["Read(./**)", "Bash(npm run test:*)"],
  ask: ["Bash(git push:*)"],
  deny: ["Bash(rm -rf:*)"],
};

/** A file Praxis has already managed once (carries the `_praxis` marker). */
const MANAGED = reconcilePermissions("", DESIRED).text;

describe("conformance: JSON permission merge", () => {
  it("is idempotent — merging identical rules twice equals merging once", () => {
    const once = reconcilePermissions("", DESIRED);
    const twice = reconcilePermissions(once.text, DESIRED);
    const guidance = [
      `reconcilePermissions() is not idempotent: a second sync with identical rules changed the file.`,
      `A no-op sync must produce a byte-identical result (docs/wiki/merge-engine.md). In src/merge-json.ts,`,
      `retained rules must keep on-disk order and the serialized form must round-trip exactly.`,
    ].join("\n");
    expect(twice.text, guidance).toBe(once.text);
    expect(twice.changed, "second merge must report changed=false").toBe(false);
  });

  it("preserves unrelated top-level keys and the user's own permission rules", () => {
    const host = JSON.stringify(
      { model: "opus", env: { FOO: "bar" }, permissions: { allow: ["Read(./docs/**)"] } },
      null,
      2,
    );
    const result = reconcilePermissions(host, DESIRED);
    const out = JSON.parse(result.text);
    const guidance = [
      `The JSON merge clobbered content it does not own. Praxis owns ONLY the permission rule`,
      `strings it emits (tracked in the top-level _praxis key); every other key and every`,
      `user-added rule must survive (D18/D19). Check reconcilePermissions() in src/merge-json.ts.`,
    ].join("\n");
    expect(out.model, guidance).toBe("opus");
    expect(out.env?.FOO, guidance).toBe("bar");
    expect(out.permissions.allow, guidance).toContain("Read(./docs/**)"); // user rule
    expect(out.permissions.allow, guidance).toContain("Read(./**)"); // managed rule
  });

  it("removes a managed rule Praxis no longer ships, but keeps user rules", () => {
    const host = JSON.stringify(
      { permissions: { allow: ["Read(./docs/**)"] } }, // user rule, no marker yet
      null,
      2,
    );
    const first = reconcilePermissions(host, {
      allow: ["Read(./**)", "Bash(npm run lint:*)"],
      ask: [],
      deny: [],
    });
    // Policy shrinks: drop the lint rule.
    const second = reconcilePermissions(first.text, { allow: ["Read(./**)"], ask: [], deny: [] });
    const out = JSON.parse(second.text);
    const guidance = [
      `A managed rule that Praxis stopped shipping was not removed (or a user rule was wrongly`,
      `removed). On update, drop only rules recorded in _praxis.managed that are no longer desired;`,
      `never touch rules the user added. See reconcilePermissions() in src/merge-json.ts.`,
    ].join("\n");
    expect(out.permissions.allow, guidance).not.toContain("Bash(npm run lint:*)");
    expect(out.permissions.allow, guidance).toContain("Read(./docs/**)");
    expect(out.permissions.allow, guidance).toContain("Read(./**)");
  });

  it("never clobbers a user-edited managed rule (conflict, not overwrite)", () => {
    const tampered = JSON.parse(MANAGED);
    tampered.permissions.allow = tampered.permissions.allow.filter(
      (r: string) => r !== "Read(./**)",
    ); // user deleted a rule Praxis owns
    const edited = `${JSON.stringify(tampered, null, 2)}\n`;
    const result = reconcilePermissions(edited, DESIRED);
    const guidance = [
      `A user edit to a Praxis-managed bucket was overwritten — D10 forbids this. When a rule`,
      `recorded in _praxis.managed is missing from disk, the user edited managed content: report a`,
      `conflict (permissions.<bucket>) and leave that bucket's bytes untouched. See src/merge-json.ts.`,
    ].join("\n");
    expect(result.conflicts, guidance).toContain("permissions.allow");
    expect(JSON.parse(result.text).permissions.allow, guidance).not.toContain("Read(./**)");
  });

  it("emits valid JSON and tracks ownership in a top-level _praxis key (not inside permissions)", () => {
    const result = reconcilePermissions("", DESIRED);
    const guidance = [
      `Permission merge must emit valid JSON with ownership tracked in a TOP-LEVEL _praxis key.`,
      `The Claude Code settings schema sets permissions.additionalProperties=false but top-level`,
      `additionalProperties=true, so the marker must be a sibling of permissions, never inside it`,
      `(D11/D19). Check where reconcilePermissions() writes the marker in src/merge-json.ts.`,
    ].join("\n");
    const parsed = JSON.parse(result.text); // throws if invalid JSON
    expect(parsed._praxis?.managed?.permissions?.allow, guidance).toContain("Read(./**)");
    expect(parsed.permissions?._praxis, guidance).toBeUndefined();
  });

  it("refuses to merge into invalid JSON rather than clobbering it", () => {
    const guidance = [
      `Merging into a non-JSON destination must throw a readable error, never overwrite the file.`,
      `parseRoot() in src/merge-json.ts must reject invalid JSON so a malformed settings.json is`,
      `surfaced for the user to fix, not silently replaced.`,
    ].join("\n");
    expect(() => reconcilePermissions("{ not json", DESIRED), guidance).toThrow();
  });

  it("permissions + plugins compose into ONE settings.json write in a single sync (no same-file compose bug)", () => {
    const manifest: Manifest = {
      version: 1,
      methodology: "0.1.0",
      targets: ["claude-code"],
      packages: ["safe-permissions", "ponytail"],
    };
    const ops = planEmit(manifest);
    const settingsOps = ops.filter((o) => o.path === ".claude/settings.json");
    const guidance = [
      `Two packages providing different artifact kinds (permissions, plugins) that both target`,
      `.claude/settings.json must produce exactly ONE EmitOp for that target/path, not two ops`,
      `racing to write the same file (the same-file compose bug). Check that planEmit() in`,
      `src/emit.ts builds a single { kind: "settings" } op carrying both rules and plugins.`,
    ].join("\n");
    expect(settingsOps.length, guidance).toBe(1);
    const op = settingsOps[0]!;
    if (op.kind !== "settings") throw new Error("expected a settings op");
    expect(op.rules, guidance).toBeDefined();
    expect(op.plugins, guidance).toBeDefined();

    const first = applyOp(op, "");
    const out = JSON.parse(first.text);
    expect(out.permissions, guidance).toBeDefined();
    expect(out.extraKnownMarketplaces, guidance).toBeDefined();
    expect(out.enabledPlugins, guidance).toBeDefined();

    const second = applyOp(op, first.text);
    const idempotentGuidance = [
      `Re-syncing a settings.json that already has permissions + plugins composed must be a no-op.`,
      `Check reconcileSettings() in src/merge-json.ts.`,
    ].join("\n");
    expect(second.changed, idempotentGuidance).toBe(false);
    expect(second.text, idempotentGuidance).toBe(first.text);
  });
});
