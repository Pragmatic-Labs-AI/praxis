import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { STACKS } from "./manifest.js";
import { resolveContained } from "./path-safety.js";

/**
 * The package loader (docs/wiki/packages-and-emit.md, decisions D20/D21). Each package carries
 * a `package.yaml` declaring what it is and **provides**; the loader discovers all
 * installed packages, validates the set selected in `praxis.yaml`, and resolves
 * `requires`/`conflicts`.
 *
 * This replaces filesystem *probing* (try to load each artifact, keep what isn't
 * undefined) with a *declared* contract: a package says what it provides, and an
 * unknown package name fails loudly rather than emitting nothing (D4's "typos
 * fail loud", extended to packages).
 */

const PACKAGES_DIR = new URL("../packages/", import.meta.url);

// What a package can contribute. Closed vocabulary; each maps to an emitter path.
const ARTIFACTS = ["rules", "permissions", "commands", "plugins"] as const;
export type Artifact = (typeof ARTIFACTS)[number];

// "external" holds thin packages that declare a Claude Code plugin marketplace
// (packages/external/<pkg>/) rather than authoring methodology content directly.
// "local" marks project-local packages: `./`- or `../`-prefixed path entries in
// the target repo's praxis.yaml `packages:` list, resolved from the target repo
// itself rather than the tree Praxis ships (docs/wiki/packages-and-emit.md).
const LAYERS = ["layer1", "layer2", "decision", "external", "local"] as const;

export const packageManifestSchema = z.strictObject({
  name: z.string().min(1),
  layer: z.enum(LAYERS),
  provides: z.array(z.enum(ARTIFACTS)).min(1),
  requires: z.array(z.string().min(1)).default([]),
  conflicts: z.array(z.string().min(1)).default([]),
  // Layer 2 packages declare the stack they target; a repo only gets them when it
  // declares that stack in praxis.yaml `stacks`. Layer 1 / external packages omit it.
  // Package-side vocabulary is STACKS *plus* "workspace" (D53): "workspace" is a
  // repo trait *derived* from the manifest's `workspace:` section, never
  // declarable in `stacks:` itself (see the manifest-side STACKS enum comment in
  // src/manifest.ts) — a package can still target it, gated the same way.
  stack: z.enum([...STACKS, "workspace"]).optional(),
  // A package may declare a first-run bootstrap action. planEmit splices this into
  // any command source that contains the <!-- praxis:bootstrap-delegations --> marker,
  // so the target repo's emitted onboard command lists the delegations without the
  // target ever seeing package.yaml (D36).
  onboarding: z
    .strictObject({ command: z.string().min(1), summary: z.string().min(1) })
    .optional(),
});

export type PackageManifest = z.infer<typeof packageManifestSchema>;

export interface ResolvedPackage extends PackageManifest {
  /** Absolute path to the package directory (where its artifacts live). */
  dir: string;
}

/** Parse + validate a `package.yaml`. `dirName` is the directory the file was
 *  found in; the declared `name` must match it. */
export function parsePackageManifest(yamlText: string, dirName: string): PackageManifest {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new Error(`package.yaml in "${dirName}" is not valid YAML: ${(err as Error).message}`);
  }
  const result = packageManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`package.yaml in "${dirName}" is invalid:\n${issues}`);
  }
  if (result.data.name !== dirName) {
    throw new Error(
      `package.yaml name "${result.data.name}" must match its directory "${dirName}".`,
    );
  }
  return result.data;
}

/** Every installed package, keyed by name. Scans `packages/<layer>/<pkg>/package.yaml`. */
export function availablePackages(): Map<string, ResolvedPackage> {
  const root = fileURLToPath(PACKAGES_DIR);
  const out = new Map<string, ResolvedPackage>();
  for (const layer of readdirSync(root, { withFileTypes: true })) {
    if (!layer.isDirectory()) continue;
    const layerDir = join(root, layer.name);
    for (const pkg of readdirSync(layerDir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const dir = join(layerDir, pkg.name);
      const manifestPath = join(dir, "package.yaml");
      if (!existsSync(manifestPath)) continue; // a directory without a manifest is not a package
      const manifest = parsePackageManifest(readFileSync(manifestPath, "utf8"), pkg.name);
      out.set(manifest.name, { ...manifest, dir });
    }
  }
  return out;
}

/**
 * Resolve the selected package names against what's available, enforcing the
 * composition rule (docs/wiki/packages-and-emit.md): every name must exist, every `requires` must also be
 * selected, no two selected packages may `conflict`, and a package targeting a
 * stack is only valid when the repo declares that stack. Pure — `available` and
 * `declaredStacks` are injected so the logic is testable without the filesystem.
 * Throws an agent-actionable error on the first problem.
 */
export function resolve(
  selected: string[],
  available: Map<string, ResolvedPackage>,
  declaredStacks: string[] = [],
): ResolvedPackage[] {
  const resolved = selected.map((name) => {
    const pkg = available.get(name);
    if (!pkg) {
      throw new Error(
        `praxis.yaml lists package "${name}" but no such package is installed.\n` +
          `Available packages: ${[...available.keys()].sort().join(", ") || "(none)"}.`,
      );
    }
    return pkg;
  });

  const selectedSet = new Set(selected);
  const stackSet = new Set(declaredStacks);
  for (const pkg of resolved) {
    if (pkg.stack && !stackSet.has(pkg.stack)) {
      // "workspace" is derived (D53), never declarable in `stacks:` — the
      // manifest's STACKS enum rejects it, so the generic "add X to `stacks`"
      // advice below would send the agent down a dead end. One workspace-specific
      // branch in an otherwise-generic error is an accepted wart (see the brief).
      if (pkg.stack === "workspace") {
        throw new Error(
          `Package "${pkg.name}" targets the "workspace" stack, which this repo does not have.\n` +
            `Add a \`workspace:\` section to praxis.yaml, or remove the package — "workspace" is ` +
            `derived from that section and cannot be added to \`stacks\` directly (D53).`,
        );
      }
      throw new Error(
        `Package "${pkg.name}" targets the "${pkg.stack}" stack, which praxis.yaml does not declare.\n` +
          `Add "${pkg.stack}" to \`stacks\` in praxis.yaml, or remove the package — a Layer 2 ` +
          `recipe applies only when its stack is wanted (D15).`,
      );
    }
    for (const req of pkg.requires) {
      if (!selectedSet.has(req)) {
        throw new Error(
          `Package "${pkg.name}" requires "${req}", which is not in praxis.yaml.\n` +
            `Add "${req}" to packages — a rule without its required support is broken (D21).`,
        );
      }
    }
    for (const con of pkg.conflicts) {
      if (selectedSet.has(con)) {
        throw new Error(
          `Packages "${pkg.name}" and "${con}" conflict and cannot be installed together.\n` +
            `Remove one from praxis.yaml.`,
        );
      }
    }
  }
  return resolved;
}

/** True for a `praxis.yaml` packages entry that names a project-local package
 *  path (relative to the target repo cwd) rather than a shipped package name. */
export function isLocalPackagePath(entry: string): boolean {
  return entry.startsWith("./") || entry.startsWith("../");
}

/** Load a project-local package from `entry` (a `./`- or `../`-prefixed path in
 *  `praxis.yaml`), resolved against `cwd`. Fails loud if there's no
 *  `package.yaml` at that path, or if it doesn't declare `layer: local` — a
 *  project-local package must say so itself so provenance stays legible
 *  (shipped vs. project-owned) without cross-referencing praxis.yaml.
 *
 *  Canonicalized and contained to `cwd` (D54, consumer-repo safety)
 *  before anything under `entry` is ever read: a literal `../` or a symlinked
 *  directory can otherwise resolve outside the repo, and Praxis has no trust
 *  override for that yet — refuse rather than silently load it. */
export function loadLocalPackage(entry: string, cwd: string): ResolvedPackage {
  const dir = resolveContained(cwd, entry, "project-local package path");
  const manifestPath = join(dir, "package.yaml");
  if (!existsSync(manifestPath)) {
    throw new Error(`praxis.yaml lists local package "${entry}" but no package.yaml exists at that path.`);
  }
  const manifest = parsePackageManifest(readFileSync(manifestPath, "utf8"), basename(dir));
  if (manifest.layer !== "local") {
    throw new Error(
      `Local package "${entry}" declares layer: ${manifest.layer}, but a project-local package ` +
        `(a "./"-prefixed praxis.yaml entry) must declare \`layer: local\` — this keeps provenance ` +
        `legible (shipped vs. project-owned) without cross-referencing praxis.yaml. Set \`layer: local\` ` +
        `in ${entry}/package.yaml.`,
    );
  }
  return { ...manifest, dir };
}

/**
 * Resolve the selected packages against the installed set (filesystem-backed),
 * plus any project-local packages the manifest names by path. A `./`- or
 * `../`-prefixed entry is loaded from `cwd` via `loadLocalPackage`, checked for
 * a name collision against every already-available package (shipped or an
 * earlier local entry), and added to the available set under its declared
 * name; non-path entries pass through unchanged. The actual composition rule
 * (requires/conflicts/stack) still lives in the pure `resolve()` above.
 */
export function resolvePackages(
  selected: string[],
  declaredStacks: string[] = [],
  cwd: string = process.cwd(),
): ResolvedPackage[] {
  const available = availablePackages();
  const mapped = selected.map((entry) => {
    if (!isLocalPackagePath(entry)) return entry;
    const local = loadLocalPackage(entry, cwd);
    const existing = available.get(local.name);
    if (existing) {
      throw new Error(
        `Local package "${entry}" collides with an already-installed package named "${local.name}".\n` +
          `Rename its directory.`,
      );
    }
    available.set(local.name, local);
    return local.name;
  });
  return resolve(mapped, available, declaredStacks);
}
