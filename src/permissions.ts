import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { resolveContained } from "./path-safety.js";
import { BUCKETS } from "./merge-json.js";

/**
 * The neutral permission policy — a content package's *second artifact kind*
 * (docs/wiki/packages-and-emit.md "provides", docs/wiki/emitters.md; decisions D18/D19). Where `rules.md` is
 * tool-neutral prose, `permissions.yaml` is tool-neutral **structured intent**:
 * it lists semantic *capabilities* in allow/ask/deny buckets. It is deliberately
 * NOT a list of Claude Code rule strings — that would make the source tool-bound.
 * Per-tool emitters translate each capability to concrete rules (or emit nothing
 * where the tool has no permission model). This keeps "tool-neutral by
 * construction" intact for the enforcement layer too.
 *
 * The capability vocabulary is closed (a zod enum): a policy may only reference
 * capabilities every emitter knows how to translate, so a capability can never be
 * silently dropped. Adding a capability is a deliberate edit here plus a mapping
 * in each emitter — verified by conformance.
 */

// The closed capability vocabulary. Each is a durable, tool-agnostic intent;
// emitters own the concrete per-tool translation. Grows deliberately.
const CAPABILITIES = [
  "read-repo", // read files in the repository
  "edit-repo", // create / edit / write files in the repository
  "run-dev-scripts", // project scripts: test, lint, typecheck, build
  "read-only-git", // git status / diff / log
  "git-commit", // commit locally
  "git-push", // push to a remote
  "install-deps", // add / install project dependencies
  "destructive-delete", // rm -rf and recursive force-deletes
  "force-push", // git push --force
  "read-secrets", // .env, *.pem, credential files
  "global-install", // global package installs (npm/pnpm/yarn -g)
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const capabilityList = z.array(z.enum(CAPABILITIES)).default([]);

// A policy is the same three buckets the merge owns; each holds capabilities.
export const policySchema = z.strictObject({
  allow: capabilityList,
  ask: capabilityList,
  deny: capabilityList,
});

export type Policy = z.infer<typeof policySchema>;

/** Parse + validate neutral policy text. Throws a readable, agent-actionable
 *  error naming each problem — mirrors parseManifest in src/manifest.ts. */
export function parsePolicy(yamlText: string): Policy {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new Error(`permissions.yaml is not valid YAML: ${(err as Error).message}`);
  }
  const result = policySchema.safeParse(raw ?? {});
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `permissions.yaml is invalid:\n${issues}\n` +
        `Capabilities must be one of: ${CAPABILITIES.join(", ")}. ` +
        `Add a new capability in src/permissions.ts and map it in every emitter.`,
    );
  }
  return result.data;
}

/** The neutral policy for a content package, or undefined if it provides none.
 *  Reads `<dir>/permissions.yaml` — mirrors loadPackageSource (src/emit.ts),
 *  including its D54 containment: a symlinked permissions.yaml must not be
 *  read through to a file outside the package's own directory. */
export function loadPolicy(dir: string): Policy | undefined {
  const candidate = resolveContained(dir, "permissions.yaml", "package permissions.yaml");
  return existsSync(candidate) ? parsePolicy(readFileSync(candidate, "utf8")) : undefined;
}

/** All capabilities referenced by a policy, across every bucket. */
export function policyCapabilities(policy: Policy): Capability[] {
  return BUCKETS.flatMap((b) => policy[b]);
}
