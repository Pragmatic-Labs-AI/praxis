import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { resolveContained } from "./path-safety.js";

/**
 * The declarative plugin-marketplace artifact (a content package's *fourth
 * artifact kind*, docs/wiki/packages-and-emit.md "provides"). A thin package under
 * `packages/external/<pkg>/` declares a Claude Code plugin marketplace and which
 * plugins to enable; the emitter writes that declaration into
 * `.claude/settings.json` (`extraKnownMarketplaces` + `enabledPlugins`) via the
 * JSON merge engine. Praxis never executes anything — no npx, no git clone, no
 * network at sync time. Writing those keys is enough for Claude Code itself to
 * prompt the user/team to install and enable on next folder-trust.
 *
 * Mirrors `src/permissions.ts`: a neutral, validated YAML source per package,
 * loaded by scanning `packages/<layer>/<pkg>/plugins.yaml`.
 */

// Marketplace source kinds Claude Code supports. Only "github" is verified and
// in use today; the schema is closed so an unverified source kind fails loud
// rather than being silently accepted and mis-emitted.
const marketplaceSourceSchema = z.strictObject({
  source: z.literal("github"),
  repo: z.string().min(1),
  // Honest pinning: `ref` (a tag/branch) and/or `sha` (a commit). `sha` paired
  // with `ref` is the effective pin; neither is required (some repos genuinely
  // have no tags — never fabricate one).
  ref: z.string().min(1).optional(),
  sha: z.string().min(1).optional(),
});

const marketplaceSchema = z.strictObject({
  name: z.string().min(1),
  source: marketplaceSourceSchema,
});

const codexPluginSchema = z.strictObject({
  name: z.string().min(1),
  subdir: z.string().min(1).optional(),
  category: z.string().min(1),
  installation: z.enum(["AVAILABLE", "INSTALLED_BY_DEFAULT", "NOT_AVAILABLE"]).default("INSTALLED_BY_DEFAULT"),
  authentication: z.enum(["ON_INSTALL", "ON_USE"]).default("ON_INSTALL"),
});

export const pluginsBlockSchema = z.strictObject({
  // Targets this declaration applies to; validated against known Targets by the
  // caller (manifest.ts owns the Target enum, plugins.ts stays decoupled from it).
  targets: z.array(z.string().min(1)).min(1),
  marketplace: marketplaceSchema,
  // "<plugin>@<marketplace-name>" — validated against marketplace.name below.
  enable: z.array(z.string().min(1)).min(1),
  /** Present only after the referenced revision's Codex plugin manifest is verified. */
  codex: codexPluginSchema.optional(),
});

export type PluginsBlock = z.infer<typeof pluginsBlockSchema>;

/** Parse + validate neutral plugins.yaml text. Throws a readable,
 *  agent-actionable error naming each problem — mirrors parsePolicy. */
export function parsePluginsBlock(yamlText: string, pkgName: string): PluginsBlock {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new Error(`plugins.yaml in "${pkgName}" is not valid YAML: ${(err as Error).message}`);
  }
  const result = pluginsBlockSchema.safeParse(raw ?? {});
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`plugins.yaml in "${pkgName}" is invalid:\n${issues}`);
  }

  // Every `enable` entry's `@<marketplace>` must equal marketplace.name — fail
  // loud rather than silently emit a plugin pinned to a marketplace that isn't
  // declared (an enabledPlugins entry Claude Code could never resolve).
  const { marketplace, enable } = result.data;
  for (const entry of enable) {
    const at = entry.lastIndexOf("@");
    const suffix = at === -1 ? undefined : entry.slice(at + 1);
    if (suffix !== marketplace.name) {
      throw new Error(
        `plugins.yaml in "${pkgName}" is invalid:\n` +
          `  - enable: "${entry}" must end in "@${marketplace.name}" to match the declared marketplace.`,
      );
    }
  }

  return result.data;
}

/** The neutral plugins declaration for a content package, or undefined if it
 *  provides none. Reads `<dir>/plugins.yaml` — mirrors loadPolicy
 *  (src/permissions.ts), including its D54 containment: a symlinked
 *  plugins.yaml must not be read through to a file outside the package's own
 *  directory. */
export function loadPluginsBlock(dir: string): PluginsBlock | undefined {
  const candidate = resolveContained(dir, "plugins.yaml", "package plugins.yaml");
  return existsSync(candidate) ? parsePluginsBlock(readFileSync(candidate, "utf8"), basename(dir)) : undefined;
}
