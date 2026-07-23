import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { applyOp, BLOCK_FILE, planEmit, type EmitOp } from "./emit.js";
import { loadManifest, type Manifest } from "./manifest.js";
import { blockStatus, findBlocks, hashContent } from "./merge.js";
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
 *
 * **Recoverable sync (D61):** the five passes below (main op loop, block-orphan
 * sweep, codex-config reconcile, marketplace prune, owned-file orphans) each
 * compute their decision — reads and reconciliation — exactly as before,
 * read-only. Instead of writing/deleting as they go, every pass appends to one
 * ordered `mutations` list. Once all five passes have run (**plan**, unchanged
 * decision logic), `commitMutations` stages every write in the nearest existing
 * ancestor directory, verifies it by hash, and only then performs the actual
 * renames/unlinks — one commit boundary spanning all five passes, not just the
 * first. A confirmed methodology-pin bump can join that plan as a required,
 * manifest-first write. A failure before commit leaves every destination
 * untouched; a failure during commit converges on the next `sync` (D10/D12
 * preserved — see docs/wiki/decisions.md D61).
 */

export type FileStatus = "created" | "updated" | "unchanged" | "deleted";

export interface FileReport {
  path: string;
  status: FileStatus;
  /** Block ids the user edited; left untouched and surfaced for resolution.
   *  Also carries the synthetic "external-change" marker (D61) when the
   *  destination changed on disk between plan and commit. */
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

/** A staged write or delete failed hash verification, or every mutation could
 *  not be staged. Thrown before any destination file is touched (D61) — the
 *  repo is left byte-identical to its pre-sync state. */
export class SyncStagingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncStagingError";
  }
}

/** One planned filesystem transition, computed read-only during the plan phase
 *  and executed only in `commitMutations` (D61). `report` is the exact
 *  `FileReport` already pushed to the caller's `files` array — commit patches
 *  it in place once the mutation's real outcome (committed, or refused as an
 *  external-change conflict) is known. */
type Mutation =
  | {
      action: "write";
      path: string;
      abs: string;
      content: string;
      existingHash: string | undefined;
      report: FileReport;
      /** Abort the remaining commit when this write conflicts. Used for the
       *  manifest-first methodology bump: emitted files must never proceed
       *  against a concurrently edited manifest. */
      required?: boolean;
    }
  | { action: "delete"; path: string; abs: string; existingHash: string | undefined; report: FileReport; cleanup?: () => void };

export interface RequiredWrite {
  path: string;
  content: string;
  /** Exact plan-time bytes. Commit refuses the write if disk no longer matches. */
  existing: string;
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
export function applyManifest(
  manifest: Manifest,
  cwd: string,
  write: boolean,
  requiredWrite?: RequiredWrite,
): SyncReport {
  const ops = planEmit(manifest, cwd);

  const files: FileReport[] = [];
  const mutations: Mutation[] = [];
  if (requiredWrite) {
    const abs = resolveContained(cwd, requiredWrite.path, "required transaction file");
    const report: FileReport = {
      path: requiredWrite.path,
      status: "updated",
      conflicts: [],
      written: false,
    };
    files.push(report);
    if (write) {
      mutations.push({
        action: "write",
        path: requiredWrite.path,
        abs,
        content: requiredWrite.content,
        existingHash: hashContent(requiredWrite.existing),
        report,
        required: true,
      });
    }
  }
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
        const report: FileReport = { path: output.path, status, conflicts: output.conflicts, written: false };
        files.push(report);
        if (write && output.changed) {
          mutations.push({
            action: "write",
            path: output.path,
            abs: output.abs,
            content: output.text,
            existingHash: existed ? hashContent(output.existing) : undefined,
            report,
          });
        }
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

    // Stage safe changes only: never in check mode, never a pure no-op. `text`
    // already preserves any conflicted block, so staging it honors D10.
    const wouldWrite = status === "created" || status === "updated";
    const report: FileReport = { path: op.path, status, conflicts, written: false };
    files.push(report);
    if (write && wouldWrite) {
      mutations.push({
        action: "write",
        path: op.path,
        abs,
        content: text,
        existingHash: existing !== undefined ? hashContent(existing) : undefined,
        report,
      });
    }
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

    const report: FileReport = {
      path,
      status: pruned.changed ? "updated" : "unchanged",
      conflicts: pruned.conflicts,
      written: false,
    };
    files.push(report);
    if (write && pruned.changed) {
      mutations.push({
        action: "write",
        path,
        abs,
        content: pruned.text,
        existingHash: hashContent(existing),
        report,
      });
    }
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
        const report: FileReport = {
          path: codexConfigPath,
          status: result.changed ? "updated" : "unchanged",
          conflicts: result.conflicts,
          written: false,
        };
        files.push(report);
        if (write && result.changed) {
          mutations.push({
            action: "write",
            path: codexConfigPath,
            abs,
            content: result.text,
            existingHash: hashContent(existing),
            report,
          });
        }
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
        { path: CODEX_MARKETPLACE_PATH, abs: marketplaceAbs, existing: marketplaceExisting, text: result.marketplaceText, changed: result.marketplaceChanged, conflicts: result.conflicts },
        { path: CODEX_MARKETPLACE_STATE_PATH, abs: stateAbs, existing: stateExisting, text: result.stateText, changed: result.stateChanged, conflicts: [] },
      ]) {
        if (!output.changed && output.conflicts.length === 0) continue;
        const report: FileReport = {
          path: output.path,
          status: output.changed ? "updated" : "unchanged",
          conflicts: output.conflicts,
          written: false,
        };
        files.push(report);
        if (write && output.changed) {
          mutations.push({
            action: "write",
            path: output.path,
            abs: output.abs,
            content: output.text,
            existingHash: hashContent(output.existing),
            report,
          });
        }
      }
    } else if (stateExisting !== undefined) {
      // marketplace.json is gone (hand-deleted or never re-created) but the
      // Praxis-owned sidecar remains — it now describes nothing and would
      // otherwise orphan forever. Prune it (D46: manifest expresses absence).
      const report: FileReport = { path: CODEX_MARKETPLACE_STATE_PATH, status: "deleted", conflicts: [], written: false };
      files.push(report);
      if (write) {
        mutations.push({ action: "delete", path: CODEX_MARKETPLACE_STATE_PATH, abs: stateAbs, existingHash: hashContent(stateExisting), report });
      }
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
    const abs = resolveContained(cwd, path, "owned file to prune");
    const existing = readFileIfExists(abs);
    const report: FileReport = { path, status: "deleted", conflicts: [], written: false };
    files.push(report);
    if (write) {
      mutations.push({
        action: "delete",
        path,
        abs,
        existingHash: existing !== undefined ? hashContent(existing) : undefined,
        report,
        cleanup: () => {
          const parent = dirname(abs);
          if (path.startsWith(".agents/skills/") && existsSync(parent) && readdirSync(parent).length === 0) rmdirSync(parent);
        },
      });
    }
  }

  if (write && mutations.length > 0) commitMutations(mutations);

  return {
    files,
    changed: files.some((f) => f.status !== "unchanged"),
    hasConflicts: files.some((f) => f.conflicts.length > 0),
  };
}

/**
 * The single commit boundary (D61), spanning all five passes' mutations:
 *
 * 1. **Stage** — every "write" is written to a temp file
 *    (`.praxis-tmp-<name>-<random>`) in the nearest already-existing ancestor
 *    of the destination's directory (`nearestExistingDir` below) — never a
 *    directory staging itself creates, so an abort before commit leaves zero
 *    new directories, not just zero new files. A freshly `mkdir`'d directory
 *    is always on its parent's filesystem/device, so the commit-phase rename
 *    out of that ancestor stays same-filesystem/atomic once the real
 *    destination directory is created in the commit phase below. The temp
 *    path is recorded for cleanup *before* the write itself is attempted, so
 *    a write that throws after partially (or fully) landing its bytes still
 *    gets swept up by the `finally` cleanup below.
 * 2. **Verify** — each staged temp is re-read and hashed against the intended
 *    content (mirrors the hashing `merge.ts` `hashContent` already does for
 *    block markers). Any mismatch deletes every staged temp and throws —
 *    no destination path has been opened for writing yet.
 * 3. **Commit** — only after every mutation is staged and verified:
 *    `renameSync`/`unlinkSync` in plan order. Immediately before each
 *    write's rename, its destination directory is created (`mkdirSync`,
 *    recursive) — the first point at which staging a "write" mutation may
 *    create a directory. Immediately before that, the destination is
 *    re-hashed against what plan time saw: a destination that existed at plan
 *    time must still match that hash; a destination that was *absent* at plan
 *    time must still be absent. Either mismatch means something else changed
 *    it since sync started reading — refuse to overwrite it and surface an
 *    "external-change" conflict (D10's conflict-not-clobber contract,
 *    generalized to whole-file granularity, including a destination created
 *    from nothing by a concurrent process) rather than clobbering it.
 *
 * A crash between two commit-phase renames is not yet plan-wide atomic (that
 * is the separable stronger increment — journal + verified backups +
 * rollback); this increment guarantees only that failure *before* commit is a
 * no-op, and that a converged re-run after a mid-commit failure lands cleanly.
 */
function commitMutations(mutations: Mutation[]): void {
  const staged: Array<{ mutation: Extract<Mutation, { action: "write" }>; tempPath: string }> = [];
  try {
    // STAGE — no destination directory is created here (see above); temp
    // files land in an already-existing ancestor directory instead.
    for (const mutation of mutations) {
      if (mutation.action !== "write") continue;
      const tempPath = tempPathFor(mutation.abs);
      staged.push({ mutation, tempPath }); // tracked before the write, not after
      writeFileSync(tempPath, mutation.content, "utf8");
    }

    // VERIFY
    for (const { mutation, tempPath } of staged) {
      const actual = readFileSync(tempPath, "utf8");
      if (hashContent(actual) !== hashContent(mutation.content)) {
        throw new SyncStagingError(
          `Staged write for "${mutation.path}" failed verification (content hash mismatch after ` +
            `write-back) — aborting sync before any destination file was touched. Re-run \`praxis sync\`.`,
        );
      }
    }

    // COMMIT — the external-change re-hash covers both directions: existed at
    // plan time and now differs, or was absent at plan time and now exists.
    const tempByMutation = new Map(staged.map(({ mutation, tempPath }) => [mutation, tempPath] as const));
    for (const mutation of mutations) {
      const onDisk = readFileIfExists(mutation.abs);
      const onDiskHash = onDisk !== undefined ? hashContent(onDisk) : undefined;
      const externalChange =
        mutation.existingHash !== undefined
          ? onDiskHash !== mutation.existingHash // existed at plan time: must be unchanged
          : onDisk !== undefined; // absent at plan time: must still be absent
      if (externalChange) {
        mutation.report.conflicts.push("external-change");
        if (mutation.action === "write" && mutation.required) break;
        continue;
      }
      if (mutation.action === "write") {
        const tempPath = tempByMutation.get(mutation);
        if (tempPath === undefined) continue; // unreachable: every write mutation is staged above
        mkdirSync(dirname(mutation.abs), { recursive: true });
        renameSync(tempPath, mutation.abs);
      } else {
        unlinkSync(mutation.abs);
        mutation.cleanup?.();
      }
      mutation.report.written = true;
    }
  } finally {
    // Leftover `.praxis-tmp-*` cleanup: a temp already renamed no longer exists
    // at its temp path; one refused by external-change detection, or one staged
    // before a later mutation aborted the run, still does and must not leak.
    for (const { tempPath } of staged) {
      if (existsSync(tempPath)) {
        try {
          unlinkSync(tempPath);
        } catch {
          // best-effort: an unremovable temp is inert (never emitted, never
          // counted as owned output — the `.praxis-tmp-` prefix doesn't match
          // the `praxis-` ownership convention findOwnedOrphans looks for).
        }
      }
    }
  }
}

/** Nearest already-existing ancestor of `dir` (inclusive) — a freshly `mkdir`'d
 *  directory is always created on its parent's filesystem/device, so staging a
 *  temp file here (rather than in `dir` itself, which may not exist yet)
 *  keeps the eventual commit-phase rename same-filesystem/atomic without
 *  staging ever having to create a destination directory. */
function nearestExistingDir(dir: string): string {
  let current = dir;
  for (;;) {
    if (existsSync(current)) return current;
    const parent = dirname(current);
    if (parent === current) return current; // reached the filesystem root
    current = parent;
  }
}

function tempPathFor(destAbs: string): string {
  const stagingDir = nearestExistingDir(dirname(destAbs));
  return join(stagingDir, `.praxis-tmp-${basename(destAbs)}-${randomBytes(6).toString("hex")}`);
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
