/**
 * JSON-aware managed merge for `.claude/settings.json` (docs/wiki/merge-engine.md,
 * decisions D10/D11/D18/D19). The markdown engine in `src/merge.ts` owns spans of *text*
 * delimited by HTML-comment markers; that trick has **no JSON equivalent** — JSON
 * has no comments. So this module is the structured-config analogue: Praxis owns
 * only the **individual entries** it emits — permission rule strings, marketplace
 * declarations, enabled-plugin keys — deep-merged into the host file, and records
 * exactly which entries are its own in a self-contained top-level `_praxis` key
 * (the JSON-native marker; D11 — no separate lockfile). One reconcile pass owns
 * the whole file so two concerns (permissions, plugins) never compose into two
 * separate writes of the same path (the same-file compose bug).
 *
 * Invariants (mirrors the markdown engine, verified by conformance):
 *   - User-added entries in the same structures survive untouched (per-entry
 *     ownership).
 *   - Entries Praxis previously emitted but no longer ships are removed on update.
 *   - If the user edited/removed one of Praxis's managed entries, that group is a
 *     **conflict, never a clobber** (D10): left exactly as-is, surfaced.
 *   - Idempotent: re-merging identical input is a byte-for-byte no-op.
 *   - Every other key in the file (model, env, defaultMode, …) is preserved.
 *
 * The `_praxis` key is a valid top-level addition: the Claude Code settings schema
 * sets top-level `additionalProperties: true` (verified against
 * json.schemastore.org/claude-code-settings.json), while `permissions` itself is
 * `additionalProperties: false` — hence the marker lives as a top-level sibling of
 * `permissions`/`extraKnownMarketplaces`/`enabledPlugins`, never inside them.
 */

/** The three permission buckets Praxis manages, in stable emit order. */
export const BUCKETS = ["allow", "ask", "deny"] as const;
export type Bucket = (typeof BUCKETS)[number];

/** A set of concrete, already-tool-translated rule strings per bucket. */
export type RuleSet = Record<Bucket, string[]>;

/** A Claude Code plugin marketplace source (today: github repo, optionally
 *  pinned by ref/sha — see src/plugins.ts for the validated package shape). */
export interface MarketplaceSource {
  source: "github";
  repo: string;
  ref?: string;
  sha?: string;
}

/** One marketplace declaration, keyed by its name. */
export interface MarketplaceEntry {
  name: string;
  source: MarketplaceSource;
}

/** The desired plugin-marketplace state: marketplaces to declare and
 *  "<plugin>@<marketplace>" keys to enable. */
export interface PluginsDesired {
  marketplaces: MarketplaceEntry[];
  enable: string[];
}

export interface JsonReconcileResult {
  /** The resulting file text (pretty-printed JSON, trailing newline). */
  text: string;
  /** Whether any byte changed. */
  changed: boolean;
  /** Group ids (`permissions.allow`, `plugins.marketplaces`, `plugins.enable`)
   *  the user edited; left untouched. */
  conflicts: string[];
}

/** The shape of the self-contained ownership marker stored in the host file. */
interface PraxisMarker {
  managed?: {
    permissions?: Partial<Record<Bucket, string[]>>;
    marketplaces?: string[];
    plugins?: string[];
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Settings this reconcile pass should bring the host file in line with. Either
 *  may be omitted — a sync that emits only permissions (or only plugins) leaves
 *  the other concern's previously-managed entries alone, neither adding nor
 *  removing them, since "omitted" here means "this op didn't run," not "empty." */
export interface DesiredSettings {
  permissions?: RuleSet;
  plugins?: PluginsDesired;
}

/**
 * Bring `.claude/settings.json` in line with the desired permissions and/or
 * plugin-marketplace state in a single pass — the only function that may write
 * this file, so permissions and plugins compose into one write instead of two
 * operations racing on the same path. Splices only the entries Praxis owns;
 * preserves user entries and every unrelated key; refuses to overwrite a group
 * the user has edited (conflict). Pure; no I/O.
 *
 * @param existing  the destination file's current text ("" if it does not exist)
 * @param desired   the permissions and/or plugins state Praxis wants to own
 */
export function reconcileSettings(existing: string, desired: DesiredSettings): JsonReconcileResult {
  const root = parseRoot(existing);
  const marker: PraxisMarker = isObject(root._praxis) ? (root._praxis as PraxisMarker) : {};
  const managed = marker.managed ?? {};
  const conflicts: string[] = [];
  const newManaged: PraxisMarker["managed"] = {};

  if (desired.permissions) {
    const recorded = managed.permissions ?? {};
    const permissions: Record<string, unknown> = isObject(root.permissions)
      ? (root.permissions as Record<string, unknown>)
      : {};
    const newRecorded: Partial<Record<Bucket, string[]>> = {};

    for (const bucket of BUCKETS) {
      const onDisk = asStringArray(permissions[bucket]);
      const rec = asStringArray(recorded[bucket]);
      const want = desired.permissions[bucket] ?? [];

      // Conflict, never clobber (D10): the managed set is intact only if every
      // rule Praxis last emitted is still present.
      const intact = rec.every((r) => onDisk.includes(r));
      if (!intact) {
        conflicts.push(`permissions.${bucket}`);
        newRecorded[bucket] = rec;
        continue;
      }

      const recSet = new Set(rec);
      const wantSet = new Set(want);
      const merged: string[] = [];
      for (const r of onDisk) {
        if (!recSet.has(r) || wantSet.has(r)) merged.push(r);
      }
      for (const r of want) {
        if (!merged.includes(r)) merged.push(r);
      }

      if (merged.length > 0) permissions[bucket] = merged;
      else delete permissions[bucket];
      if (want.length > 0) newRecorded[bucket] = want;
    }

    if (Object.keys(permissions).length > 0) root.permissions = permissions;
    else delete root.permissions;
    if (Object.keys(newRecorded).length > 0) newManaged.permissions = newRecorded;
  } else if (managed.permissions) {
    // Not part of this sync — keep tracking what we previously owned untouched.
    newManaged.permissions = managed.permissions;
  }

  if (desired.plugins) {
    const recordedMarketplaces = managed.marketplaces ?? [];
    const recordedPlugins = managed.plugins ?? [];

    const marketplaces: Record<string, unknown> = isObject(root.extraKnownMarketplaces)
      ? (root.extraKnownMarketplaces as Record<string, unknown>)
      : {};
    const enabledPlugins: Record<string, unknown> = isObject(root.enabledPlugins)
      ? (root.enabledPlugins as Record<string, unknown>)
      : {};

    const marketplacesIntact = recordedMarketplaces.every((name) => name in marketplaces);
    const pluginsIntact = recordedPlugins.every((key) => key in enabledPlugins);

    if (!marketplacesIntact) {
      // Conflict, never clobber (D10): leave extraKnownMarketplaces exactly as
      // found on disk (including a present-but-empty `{}`), don't recompute it.
      conflicts.push("plugins.marketplaces");
      newManaged.marketplaces = recordedMarketplaces;
    } else {
      const wantNames = new Set(desired.plugins.marketplaces.map((m) => m.name));
      for (const name of Object.keys(marketplaces)) {
        if (recordedMarketplaces.includes(name) && !wantNames.has(name)) delete marketplaces[name];
      }
      for (const m of desired.plugins.marketplaces) {
        marketplaces[m.name] = { source: m.source };
      }
      if (Object.keys(marketplaces).length > 0) root.extraKnownMarketplaces = marketplaces;
      else delete root.extraKnownMarketplaces;
      if (desired.plugins.marketplaces.length > 0) {
        newManaged.marketplaces = desired.plugins.marketplaces.map((m) => m.name);
      }
    }

    if (!pluginsIntact) {
      // Same conflict rule for enabledPlugins, independently of marketplaces.
      conflicts.push("plugins.enable");
      newManaged.plugins = recordedPlugins;
    } else {
      const wantKeys = new Set(desired.plugins.enable);
      for (const key of Object.keys(enabledPlugins)) {
        if (recordedPlugins.includes(key) && !wantKeys.has(key)) delete enabledPlugins[key];
      }
      for (const key of desired.plugins.enable) {
        enabledPlugins[key] = true;
      }
      if (Object.keys(enabledPlugins).length > 0) root.enabledPlugins = enabledPlugins;
      else delete root.enabledPlugins;
      if (desired.plugins.enable.length > 0) newManaged.plugins = desired.plugins.enable;
    }
  } else {
    if (managed.marketplaces) newManaged.marketplaces = managed.marketplaces;
    if (managed.plugins) newManaged.plugins = managed.plugins;
  }

  if (Object.keys(newManaged).length > 0) {
    root._praxis = { managed: newManaged };
  } else {
    delete root._praxis;
  }

  const text = `${JSON.stringify(root, null, 2)}\n`;
  return { text, changed: text !== normalize(existing), conflicts };
}

/** Permissions-only convenience wrapper over `reconcileSettings` — kept because
 *  most call sites and tests only ever reconcile permissions. */
export function reconcilePermissions(existing: string, desired: RuleSet): JsonReconcileResult {
  return reconcileSettings(existing, { permissions: desired });
}

/** Parse the host file into a mutable object, preserving key order. Empty/blank
 *  → `{}`. Invalid JSON throws a readable error rather than risk a clobber. */
function parseRoot(existing: string): Record<string, unknown> {
  if (existing.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch (err) {
    throw new Error(
      `Cannot merge settings: the destination file is not valid JSON ` +
        `(${(err as Error).message}). Fix or remove it, then re-run \`praxis sync\`.`,
    );
  }
  if (!isObject(parsed)) {
    throw new Error(
      `Cannot merge settings: the destination file must be a JSON object, ` +
        `got ${Array.isArray(parsed) ? "an array" : typeof parsed}.`,
    );
  }
  return parsed as Record<string, unknown>;
}

/** The byte-form a no-op write would produce for the given input, used to compute
 *  `changed` honestly when the input is already-formatted JSON. */
function normalize(existing: string): string {
  if (existing.trim() === "") return "";
  try {
    return `${JSON.stringify(JSON.parse(existing), null, 2)}\n`;
  } catch {
    return existing;
  }
}
