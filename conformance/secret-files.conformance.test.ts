import { describe, expect, it } from "vitest";
import { CODEX_CONFIG_BODY } from "../src/codex-security.js";
import { planEmit } from "../src/emit.js";
import type { Manifest } from "../src/manifest.js";
import { READABLE_TEMPLATE_NAMES, SECRET_FILE_PATTERNS } from "../src/permissions.js";
import { currentMethodology } from "../test/helpers.js";

/**
 * Conformance: what `read-secrets` denies is one neutral list, translated
 * identically by every emitter, and conventional `.env` templates stay readable
 * (docs/wiki/emitters.md, D18/D19).
 *
 * This inverts two real 0.3.0 bugs:
 *   1. `Read(./.env.*)` denied `.env.example` — a committed template with no
 *      secrets that an agent needs in order to author a real `.env`. Deny beats
 *      allow in Claude Code, so no consumer could carve it out downstream.
 *   2. The emitters had already drifted: Claude denied a root-anchored
 *      `.env.*` while Codex denied a globstar-prefixed `.env*`, so one repo got
 *      different effective policy per target (Codex also swept in `.envrc`).
 *
 * Assertions are on the emitted rule *strings* and on the neutral pattern list
 * itself — never on what Claude Code's matcher would do with them. The settings
 * docs do not specify that matcher's syntax, so a test resolving rules through
 * some locally-chosen glob library would pin that library's behaviour rather
 * than the tool's. `couldMatch` below is deliberately the other thing: a
 * conservative reading of *our own* patterns under ordinary glob semantics,
 * used only to prove a pattern cannot swallow a template name.
 */

/** Does `pattern` match `name` under ordinary glob semantics (`*` = any run of
 *  non-separator characters)? Conservative by construction: it is used only to
 *  reject patterns that would deny a template, so over-matching fails loudly
 *  and under-matching is impossible for the literal-name patterns we ship. */
function couldMatch(pattern: string, name: string): boolean {
  const source = pattern
    .split("*")
    .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${source}$`).test(name);
}

const MANIFEST: Manifest = {
  version: 1,
  methodology: currentMethodology(),
  targets: ["claude-code", "agents-md"],
  packages: ["karpathy-claude", "safe-permissions"],
};

function claudeDenyRules(): string[] {
  const op = planEmit(MANIFEST).find((o) => o.kind === "settings" && o.rules);
  if (!op || op.kind !== "settings" || !op.rules) throw new Error("expected a settings op with rules");
  return op.rules.deny;
}

describe("conformance: secret-file policy", () => {
  it("emits no blanket .env wildcard — the rule that made .env.example unreadable", () => {
    const guidance = [
      `A deny pattern matching ".env" plus a trailing open wildcard is back. That form denies`,
      `.env.example, .env.sample and friends, and deny beats allow in Claude Code so no consumer can`,
      `carve them out — narrowing the emitted glob was the only available fix. Keep read-secrets`,
      `enumerated via SECRET_FILE_PATTERNS (src/permissions.ts); do not reintroduce ".env.*" or`,
      `".env*". A bounded wildcard such as ".env.*.local" is fine — it cannot swallow a template.`,
    ].join("\n");
    // Only an *unbounded* trailing wildcard is the bug; ".env.*.local" is bounded by its suffix.
    for (const pattern of SECRET_FILE_PATTERNS) {
      expect(pattern, `${guidance}\nOffending pattern: ${pattern}`).not.toMatch(/^\.env\.?\*$/);
    }
    expect(claudeDenyRules(), guidance).not.toContain("Read(./.env.*)");
    expect(CODEX_CONFIG_BODY, guidance).not.toContain(`"**/.env*"`);
  });

  it("keeps every conventional template name readable on both targets", () => {
    const guidance = [
      `A conventional .env template must not be denied — agents read it to author a real .env, and`,
      `it carries no secrets by definition. Adding a pattern to SECRET_FILE_PATTERNS`,
      `(src/permissions.ts) that matches one of READABLE_TEMPLATE_NAMES breaks this. Note this`,
      `catches a greedy pattern too (".env.ex*" would swallow .env.example), not just a literal name.`,
    ].join("\n");
    for (const template of READABLE_TEMPLATE_NAMES) {
      for (const pattern of SECRET_FILE_PATTERNS) {
        expect(couldMatch(pattern, template), `${guidance}\n${template} is matched by: ${pattern}`)
          .toBe(false);
      }
      for (const rule of claudeDenyRules()) {
        expect(rule, `${guidance}\n${template} is denied by: ${rule}`).not.toContain(template);
      }
      expect(CODEX_CONFIG_BODY, `${guidance}\n${template} is denied by the Codex profile`)
        .not.toContain(template);
    }
  });

  it("translates the same neutral list on Claude Code and Codex (no per-target drift)", () => {
    const guidance = [
      `Claude Code and Codex must deny the same neutral secret shapes, or one repo gets a different`,
      `effective policy per target — exactly the 0.3.0 drift where Claude denied a root-anchored`,
      `".env.*" and Codex denied "**/.env*". Both emitters derive from SECRET_FILE_PATTERNS`,
      `(src/permissions.ts): readSecretsRules() in src/emit.ts and CODEX_SECRET_DENY_LINES in`,
      `src/codex-security.ts. Add shapes there, never to one emitter alone.`,
    ].join("\n");
    const deny = claudeDenyRules();
    for (const pattern of SECRET_FILE_PATTERNS) {
      expect(deny, `${guidance}\nClaude Code is missing the root form of: ${pattern}`)
        .toContain(`Read(./${pattern})`);
      expect(deny, `${guidance}\nClaude Code is missing the nested form of: ${pattern}`)
        .toContain(`Read(./**/${pattern})`);
      expect(CODEX_CONFIG_BODY, `${guidance}\nCodex is missing the root form of: ${pattern}`)
        .toContain(`${JSON.stringify(pattern)} = "deny"`);
      expect(CODEX_CONFIG_BODY, `${guidance}\nCodex is missing the nested form of: ${pattern}`)
        .toContain(`${JSON.stringify(`**/${pattern}`)} = "deny"`);
    }
  });

  it("states the accepted limitation: an unconventional secret name is NOT covered", () => {
    const guidance = [
      `read-secrets is an enumerated denylist, so a secret-bearing file outside SECRET_FILE_PATTERNS`,
      `— e.g. .env.secrets — is readable. That is the knowing tradeoff for making templates readable`,
      `at all (see SECRET_FILE_PATTERNS in src/permissions.ts and the 0.4.0 Upgrading note), NOT an`,
      `oversight. This test exists so the gap is visible rather than implicit: if you are closing it,`,
      `extend SECRET_FILE_PATTERNS and update this test deliberately.`,
    ].join("\n");
    const uncovered = ".env.secrets";
    for (const pattern of SECRET_FILE_PATTERNS) {
      expect(couldMatch(pattern, uncovered), `${guidance}\nNow covered by: ${pattern}`).toBe(false);
    }
  });
});
