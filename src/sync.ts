import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyOp, BLOCK_FILE, planEmit, type EmitOp } from "./emit.js";
import { loadManifest, type Manifest } from "./manifest.js";
import { blockStatus, findBlocks } from "./merge.js";
import { reconcileCodexConfig } from "./codex-security.js";
import {
  CODEX_MARKETPLACE_PATH,
  CODEX_MARKETPLACE_STATE_PATH,
  reconcileCodexMarketplace,
} from "./codex-marketplace.js";
import { resolveContained } from "./path-safety.js";

/**
 * Orchestration for `sync` and `check` (docs/wiki/interaction-model.md). Ties loader →
 * emitter → engine and performs the file I/O: read `praxis.yaml`, plan the emit,
 * apply each op against the destination file, and (in write mode) persist safe
 * changes. Never clobbers a user-edited managed block (D10) — conflicts are
 * surfaced, not overwritten.
 *
 * **Prune (D46):** the manifest expresses absence too — a package removed from
 * `praxis.yaml` orphans the files/blocks it used to emit. No separate ownership
 * ledger is needed: ownership is already legible on disk (the `praxis-` file
 * prefix; the `<!-- praxis:begin <id> -->` block markers), so prune is simply
 * (on-disk Praxis-owned set) − (manifest-implied set), previewed the same way as
 * any other change and applied only in write mode.
 */

export type FileStatus = "created" | "updated" | "unchanged" | "deleted";

export interface FileReport {
  path: string;
  status: FileStatus;
  /** Block ids the user edited; left untouched and surfaced for resolution. */
  conflicts: string[];
  /** Whether this file was written this run (false in check/dry-run mode). */
  written: boolean;
}

export interface SyncReport {
  files: FileReport[];
  /** Any file would be (or was) created/updated — i.e. the repo was out of sync. */
  changed: boolean;
  /** Any managed block was edited by the user. */
  hasConflicts: boolean;
}

export interface SyncOptions {
  cwd: string;
  /** false = check (dry-run): compute the report, write nothing. */
  write: boolean;
  manifestPath?: string;
}

export function runSync(opts: SyncOptions): SyncReport {
  const manifestPath = opts.manifestPath ?? join(opts.cwd, "praxis.yaml");
  return applyManifest(loadManifest(manifestPath), opts.cwd, opts.write);
}

/**
 * Apply an in-memory manifest against the repo. Same engine as `runSync`, but the
 * manifest comes from the caller rather than disk — `init` uses this to preview
 * the emit before `praxis.yaml` exists.
 */
export function applyManifest(manifest: Manifest, cwd: string, write: boolean): SyncReport {
  const ops = planEmit(manifest, cwd);

  const files: FileReport[] = [];
  const handledPaths = new Set<string>();
  for (const op of ops) {
    handledPaths.add(op.path);
    if (op.kind === "codex-marketplace") {
      handledPaths.add(op.statePath);
      const marketplaceAbs = resolveContained(cwd, op.path, "managed file");
      const stateAbs = resolveContained(cwd, op.statePath, "managed file");
      const marketplaceExisting = readFileIfExists(marketplaceAbs) ?? "";
      const stateExisting = readFileIfExists(stateAbs) ?? "";
      const result = reconcileCodexMarketplace(marketplaceExisting, stateExisting, op.plugins);
      for (const output of [
        { path: op.path, abs: marketplaceAbs, existing: marketplaceExisting, text: result.marketplaceText, changed: result.marketplaceChanged, conflicts: result.conflicts },
        { path: op.statePath, abs: stateAbs, existing: stateExisting, text: result.stateText, changed: result.stateChanged, conflicts: [] },
      ]) {
        const existed = existsSync(output.abs);
        const status: FileStatus = !existed ? "created" : output.changed ? "updated" : "unchanged";
        const written = write && output.changed;
        if (written) {
          mkdirSync(dirname(output.abs), { recursive: true });
          writeFileSync(output.abs, output.text, "utf8");
        }
        files.push({ path: output.path, status, conflicts: output.conflicts, written });
      }
      continue;
    }
    const abs = resolveContained(cwd, op.path, "managed file");
    const existing = readFileIfExists(abs);
    const result = applyOp(op, existing ?? "");

    let text = result.text;
    let changed = result.changed;
    let conflicts = result.conflicts;

    // Prune orphan blocks in the same pass: a block-target file (e.g. AGENTS.md)
    // may still carry a managed block for a package the manifest no longer
    // selects. Splice those out of the already-reconciled text so the file
    // report and the single write below cover both concerns together.
    if (op.kind === "block") {
      const pruned = pruneOrphanBlocks(text, new Set(Object.keys(op.blocks)));
      text = pruned.text;
      changed = changed || pruned.changed;
      conflicts = [...conflicts, ...pruned.conflicts];
    }

    const status: FileStatus = existing === undefined ? "created" : changed ? "updated" : "unchanged";

    // Write safe changes only: never in check mode, never a pure no-op. `text`
    // already preserves any conflicted block, so writing it honors D10.
    const written = write && (status === "created" || status === "updated");
    if (written) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text, "utf8");
    }

    files.push({ path: op.path, status, conflicts, written });
  }

  // Block orphans in a file the manifest no longer emits ANY block for (e.g. the
  // last rules package for a target was removed): no "block" op exists this run
  // to carry the pruning above, so sweep the known block-owned files directly.
  for (const path of new Set(Object.values(BLOCK_FILE))) {
    if (handledPaths.has(path)) continue;
    const abs = resolveContained(cwd, path, "managed file");
    const existing = readFileIfExists(abs);
    if (existing === undefined) continue;

    const pruned = pruneOrphanBlocks(existing, new Set());
    if (!pruned.changed && pruned.conflicts.length === 0) continue;

    const written = write && pruned.changed;
    if (written) writeFileSync(abs, pruned.text, "utf8");

    files.push({
      path,
      status: pruned.changed ? "updated" : "unchanged",
      conflicts: pruned.conflicts,
      written,
    });
  }

  // A removed Codex permissions package/target removes only Praxis's protected
  // TOML block; unrelated project configuration remains byte-for-byte intact.
  const codexConfigPath = ".codex/config.toml";
  if (!handledPaths.has(codexConfigPath)) {
    const abs = resolveContained(cwd, codexConfigPath, "managed file");
    const existing = readFileIfExists(abs);
    if (existing !== undefined) {
      const result = reconcileCodexConfig(existing, false);
      if (result.changed || result.conflicts.length > 0) {
        const written = write && result.changed;
        if (written) writeFileSync(abs, result.text, "utf8");
        files.push({
          path: codexConfigPath,
          status: result.changed ? "updated" : "unchanged",
          conflicts: result.conflicts,
          written,
        });
      }
    }
  }


  // Marketplace ownership lives in a committed sidecar. Without that state,
  // removal is deliberately conservative: Praxis cannot prove an entry is its own.
  if (!handledPaths.has(CODEX_MARKETPLACE_PATH)) {
    const marketplaceAbs = resolveContained(cwd, CODEX_MARKETPLACE_PATH, "managed file");
    const stateAbs = resolveContained(cwd, CODEX_MARKETPLACE_STATE_PATH, "managed file");
    const marketplaceExisting = readFileIfExists(marketplaceAbs);
    const stateExisting = readFileIfExists(stateAbs);
    if (marketplaceExisting !== undefined && stateExisting !== undefined) {
      const result = reconcileCodexMarketplace(marketplaceExisting, stateExisting, []);
      for (const output of [
        { path: CODEX_MARKETPLACE_PATH, abs: marketplaceAbs, text: result.marketplaceText, changed: result.marketplaceChanged, conflicts: result.conflicts },
        { path: CODEX_MARKETPLACE_STATE_PATH, abs: stateAbs, text: result.stateText, changed: result.stateChanged, conflicts: [] },
      ]) {
        if (!output.changed && output.conflicts.length === 0) continue;
        const written = write && output.changed;
        if (written) writeFileSync(output.abs, output.text, "utf8");
        files.push({
          path: output.path,
          status: output.changed ? "updated" : "unchanged",
          conflicts: output.conflicts,
          written,
        });
      }
    } else if (stateExisting !== undefined) {
      // marketplace.json is gone (hand-deleted or never re-created) but the
      // Praxis-owned sidecar remains — it now describes nothing and would
      // otherwise orphan forever. Prune it (D46: manifest expresses absence).
      if (write) unlinkSync(stateAbs);
      files.push({ path: CODEX_MARKETPLACE_STATE_PATH, status: "deleted", conflicts: [], written: write });
    }
  }

  // Owned-file orphans: `.claude/rules/praxis-*.md` / `.claude/commands/praxis-*.md`
  // on disk that the current manifest no longer implies (the package that used to
  // own them was removed, or its target was). The `praxis-` prefix is the
  // ownership convention; a user's own file with that prefix would be flagged too
  // — acceptable because deletion is always previewed here, never silent.
  const impliedOwnedPaths = new Set(
    ops.filter((op): op is Extract<EmitOp, { kind: "owned" }> => op.kind === "owned").map((op) => op.path),
  );
  for (const path of findOwnedOrphans(cwd, impliedOwnedPaths)) {
    if (write) {
      const abs = resolveContained(cwd, path, "owned file to prune");
      unlinkSync(abs);
      const parent = dirname(abs);
      if (path.startsWith(".agents/skills/") && readdirSync(parent).length === 0) rmdirSync(parent);
    }
    files.push({ path, status: "deleted", conflicts: [], written: write });
  }

  return {
    files,
    changed: files.some((f) => f.status !== "unchanged"),
    hasConflicts: files.some((f) => f.conflicts.length > 0),
  };
}

function readFileIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

// Directories whose contents are Praxis-owned by naming convention alone — see
// `planEmit` in src/emit.ts; files in these directories are owned by prefix.
const OWNED_ORPHAN_DIRS = [".claude/rules", ".claude/commands", ".codex/rules"] as const;

/** Praxis-owned files on disk (by the `praxis-` prefix convention) whose path is
 *  not in `impliedPaths` — the current manifest no longer emits them. */
function findOwnedOrphans(cwd: string, impliedPaths: ReadonlySet<string>): string[] {
  const orphans: string[] = [];
  for (const dir of OWNED_ORPHAN_DIRS) {
    const abs = join(cwd, dir);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const suffix = dir === ".codex/rules" ? ".rules" : ".md";
      if (!entry.isFile() || !entry.name.startsWith("praxis-") || !entry.name.endsWith(suffix)) continue;
      const path = `${dir}/${entry.name}`;
      if (!impliedPaths.has(path)) orphans.push(path);
    }
  }
  const skillsDir = join(cwd, ".agents/skills");
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("praxis-")) continue;
      const path = `.agents/skills/${entry.name}/SKILL.md`;
      if (existsSync(join(cwd, path)) && !impliedPaths.has(path)) orphans.push(path);
    }
  }
  return orphans;
}

/** Remove one managed block (both markers + content) from `text`, absorbing the
 *  blank-line separator and trailing newline that `appendBlock` (src/merge.ts)
 *  introduces when a block is first added — so removing an orphan restores the
 *  surrounding prose to exactly what it was before the block ever existed. */
function spliceOutBlock(text: string, block: { start: number; end: number }): string {
  let start = block.start;
  let end = block.end;
  if (text.slice(end, end + 1) === "\n") end += 1;
  if (text.slice(Math.max(0, start - 2), start) === "\n\n") start -= 1;
  return text.slice(0, start) + text.slice(end);
}

/** Splice every managed block out of `text` whose id is not in `keepIds` — the
 *  block-file analogue of `findOwnedOrphans`. Mirrors `reconcile`'s conflict rule
 *  (D10): a block whose content hash no longer matches its recorded marker was
 *  user-edited, so it is reported as a conflict and left untouched, never deleted. */
function pruneOrphanBlocks(
  text: string,
  keepIds: ReadonlySet<string>,
): { text: string; changed: boolean; conflicts: string[] } {
  let out = text;
  let changed = false;
  const conflicts: string[] = [];
  const skip = new Set<string>();

  for (;;) {
    const orphan = findBlocks(out).find((b) => !keepIds.has(b.id) && !skip.has(b.id));
    if (!orphan) break;
    if (blockStatus(orphan) === "user-edited") {
      conflicts.push(orphan.id);
      skip.add(orphan.id);
      continue;
    }
    out = spliceOutBlock(out, orphan);
    changed = true;
  }

  return { text: out, changed, conflicts };
}
