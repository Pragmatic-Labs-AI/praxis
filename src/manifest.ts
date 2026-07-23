import { readFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * The manifest — `praxis.yaml` (docs/wiki/interaction-model.md, decision D4). The visible,
 * committed, hand-editable declarative truth: what methodology a repo has
 * installed. `sync` reconciles the repo to it; this module reads and validates it.
 *
 * Enums are restricted to what Praxis can actually honor today. Accepting config
 * we can't act on (an unimplemented target/stack) would be a silent lie — better
 * a clear validation error. The lists grow as emitters and stacks land.
 */

// Emit targets with an implemented emitter. Grows as emitters are added.
export const TARGETS = ["claude-code", "codex", "agents-md"] as const;

// Stacks Praxis knows. Grows as Layer 2 stacks are added.
// NOTE: "workspace" (D53) is deliberately NOT a member of this enum — it is a
// repo trait *derived* from the manifest's `workspace:` section below, never
// something a user declares in `stacks:`. See the package-side vocabulary in
// src/packages.ts, which does add it (packages may target it; manifests may not).
export const STACKS = ["python-backend", "node", "react"] as const;

/** A repo-relative directory (no leading "/", no ".." segment) — the same
 *  sandbox rule as `safeRepoTarget` in src/anchors.ts, duplicated here because
 *  manifest validation has no `cwd` to resolve against (shape check only). */
function isSafeRelativePath(target: string): boolean {
  if (isAbsolute(target)) return false;
  return !target.split(/[\\/]+/).includes("..");
}

/** True when member path `a`'s segments are a prefix of (or equal to) `b`'s —
 *  i.e. `b` lives inside (or is) `a`'s directory. Used to reject overlapping
 *  workspace members ("a" and "a/b" can't both be cloned independently). */
function pathsOverlap(a: string, b: string): boolean {
  const segsA = a.split(/[\\/]+/).filter(Boolean);
  const segsB = b.split(/[\\/]+/).filter(Boolean);
  const [shorter, longer] = segsA.length <= segsB.length ? [segsA, segsB] : [segsB, segsA];
  return shorter.every((seg, i) => seg === longer[i]);
}

const memberSchema = z.strictObject({
  // Repo-relative dir under the hub root where this member is cloned.
  path: z.string().min(1),
  // Defaults to basename(path) — see `memberName` below.
  name: z.string().min(1).optional(),
});

const edgeSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  // Optional hub-wiki page describing the producer/consumer contract. Shape
  // only is validated here; existence is advisory in `check`, never a hard
  // failure — an edge can be declared before its page is written.
  contract: z.string().min(1).optional(),
});

export const workspaceSchema = z
  .strictObject({
    members: z.array(memberSchema).min(1),
    edges: z.array(edgeSchema).default([]),
  })
  .superRefine((workspace, ctx) => {
    const seenNames = new Map<string, number>();
    workspace.members.forEach((member, i) => {
      if (!isSafeRelativePath(member.path)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["members", i, "path"],
          message: `member path "${member.path}" must be repo-relative, without a leading "/" or a ".." segment`,
        });
      }

      const name = memberName(member);
      const seenAt = seenNames.get(name);
      if (seenAt !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["members", i, "name"],
          message: `duplicate member name "${name}" (also used by members[${seenAt}]) — member names must be unique`,
        });
      } else {
        seenNames.set(name, i);
      }

      for (let j = 0; j < i; j++) {
        const earlier = workspace.members[j];
        if (earlier && pathsOverlap(earlier.path, member.path)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["members", i, "path"],
            message: `member path "${member.path}" overlaps with member path "${earlier.path}" — member paths must not nest or overlap`,
          });
        }
      }
    });

    const declaredNames = new Set(workspace.members.map((m) => memberName(m)));
    workspace.edges.forEach((edge, i) => {
      if (!declaredNames.has(edge.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", i, "from"],
          message: `edge names undeclared member "${edge.from}"`,
        });
      }
      if (!declaredNames.has(edge.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", i, "to"],
          message: `edge names undeclared member "${edge.to}"`,
        });
      }
      if (edge.contract !== undefined && !isSafeRelativePath(edge.contract)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", i, "contract"],
          message: `contract path "${edge.contract}" must be repo-relative, without a leading "/" or a ".." segment`,
        });
      }
    });
  });

export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspaceMember = z.infer<typeof memberSchema>;
export type WorkspaceEdge = z.infer<typeof edgeSchema>;

/** A member's effective name: the declared `name`, else the path's basename.
 *  Single source of truth shared by manifest validation, anchor member
 *  resolution (src/anchors.ts), and the workspace status line (src/program.ts). */
export function memberName(member: WorkspaceMember): string {
  return member.name ?? basename(member.path);
}

export const manifestSchema = z.strictObject({
  version: z.literal(1),
  methodology: z.string().min(1),
  // Optional: Layer 1 is stack-agnostic, so a repo installing only general
  // methodology (like Praxis itself) declares no stacks. Present only when Layer 2
  // recipes are wanted — and a repo can be more than one stack at once (e.g. a
  // React frontend with a Node backend), so it is a list.
  stacks: z.array(z.enum(STACKS)).optional(),
  targets: z.array(z.enum(TARGETS)).min(1),
  // Package names are free strings until a package registry exists to validate
  // them against; the loader (a later phase) resolves requires/conflicts.
  packages: z.array(z.string().min(1)).min(1),
  // Optional hub-sovereign workspace tier (D53): N independent git repos
  // cloned (gitignored) inside this meta-repo. Absent for an ordinary repo.
  // Hand-added by users, or scaffolded by the init wizard when it detects
  // nested sibling repos and the user opts in (D53 WS4) — `edges` are always
  // left to the human either way.
  workspace: workspaceSchema.optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type Target = (typeof TARGETS)[number];
export type Stack = (typeof STACKS)[number];

/** Parse + validate manifest text. Throws an Error with a readable, multi-line
 *  message naming each problem and where it is — written to be acted on. */
export function parseManifest(yamlText: string): Manifest {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new Error(`praxis.yaml is not valid YAML: ${(err as Error).message}`);
  }

  const result = manifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`praxis.yaml is invalid:\n${issues}`);
  }
  return result.data;
}

/** Read and validate the manifest at `path`. */
export function loadManifest(path: string): Manifest {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `No praxis.yaml found at ${path}. Run \`praxis\` to create one.`,
    );
  }
  return parseManifest(text);
}

/** Lenient `workspace:` reader: used by `reconcile()` (src/program.ts) **only**
 *  as a fallback when the full manifest load throws (D40) — the knowledge-anchor
 *  tripwire needs member info to resolve `member:` anchors even when
 *  `praxis.yaml` is otherwise unresolvable (e.g. an old npx-cached CLI). When
 *  `loadManifest` succeeds, callers must use `manifest.workspace` directly
 *  instead — one file, one parse. Never throws: returns `undefined` on a
 *  missing file, broken YAML, an absent `workspace:` section, or one that
 *  fails validation. */
export function loadWorkspaceConfig(cwd: string): Workspace | undefined {
  let text: string;
  try {
    text = readFileSync(join(cwd, "praxis.yaml"), "utf8");
  } catch {
    return undefined;
  }

  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch {
    return undefined;
  }

  if (typeof raw !== "object" || raw === null || !("workspace" in raw)) return undefined;
  const result = workspaceSchema.safeParse((raw as { workspace?: unknown }).workspace);
  return result.success ? result.data : undefined;
}
