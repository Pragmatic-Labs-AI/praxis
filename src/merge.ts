import { createHash } from "node:crypto";

/**
 * The block-splice merge core (docs/wiki/merge-engine.md, decisions D7/D10/D11).
 *
 * Praxis owns only the text between its `praxis:begin`/`praxis:end` markers.
 * The host file is never parsed as markdown — we locate our own machine markers
 * and treat the content between them as OPAQUE text. This is the whole point of
 * rejecting a markdown AST (D7): re-serializing a tree would normalize the user's
 * prose. Here, every byte outside a managed span is preserved exactly.
 */

/** A Praxis-managed region located in a host file. */
export interface ManagedBlock {
  id: string;
  /** Exact bytes between the markers, excluding the marker lines. Opaque. */
  content: string;
  /** sha256 recorded in the begin marker (`""` if the marker carried none). */
  recordedHash: string;
  /** Offset of the block start (begin marker) in the source text. */
  start: number;
  /** Offset just past the end marker in the source text. */
  end: number;
}

export type BlockStatus = "absent" | "unchanged" | "user-edited";

const beginMarker = (id: string, hash: string): string =>
  `<!-- praxis:begin ${id} sha256=${hash} (managed by praxis - edit praxis.yaml then run: praxis sync) -->`;

const endMarker = (id: string): string => `<!-- praxis:end ${id} -->`;

// Match our own fences only. Group 1: id. Group 2: begin-marker attributes
// (carries sha256). Group 3: opaque content. The id backreference (\1) ties the
// end marker to its begin marker; content is non-greedy so the nearest end wins.
const BLOCK_RE =
  /<!--\s*praxis:begin\s+([A-Za-z0-9._-]+)([^>]*?)-->[^\n]*\r?\n([\s\S]*?)\r?\n?<!--\s*praxis:end\s+\1\s*-->/g;

function extractHash(attrs: string): string {
  const m = /sha256=([A-Za-z0-9]+)/.exec(attrs);
  return m?.[1] ?? "";
}

/** sha256 (hex) of the content. Used to detect user edits inside a block. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Render a full managed block, stamping the begin marker with a fresh hash. */
export function renderBlock(id: string, content: string): string {
  return `${beginMarker(id, hashContent(content))}\n${content}\n${endMarker(id)}`;
}

/** All managed blocks in the text, in document order. */
export function findBlocks(text: string): ManagedBlock[] {
  const blocks: ManagedBlock[] = [];
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(text)) !== null) {
    blocks.push({
      id: m[1] ?? "",
      recordedHash: extractHash(m[2] ?? ""),
      content: m[3] ?? "",
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return blocks;
}

/** The first managed block with the given id, wherever it sits in the file. */
export function findBlock(text: string, id: string): ManagedBlock | undefined {
  return findBlocks(text).find((b) => b.id === id);
}

/**
 * absent       — no such block in the file.
 * unchanged    — on-disk content still matches the recorded hash (Praxis's last
 *                emission is intact; safe to update).
 * user-edited  — on-disk content differs from the recorded hash; the user (or
 *                agent) edited managed content. Never overwrite (D10).
 */
export function blockStatus(block: ManagedBlock | undefined): BlockStatus {
  if (!block) return "absent";
  return block.recordedHash === hashContent(block.content)
    ? "unchanged"
    : "user-edited";
}

export interface ReconcileResult {
  /** The resulting file text. */
  text: string;
  /** Whether any byte changed. */
  changed: boolean;
  /** Ids of blocks the user edited; left untouched, surfaced for resolution. */
  conflicts: string[];
}

/**
 * Bring the host text in line with the desired managed content, one block per
 * entry of `desired` (id -> content). Splices only managed spans; appends blocks
 * that are absent; refuses to overwrite blocks the user has edited (conflict).
 * Idempotent: reconciling with already-applied content is a byte-for-byte no-op.
 */
export function reconcile(
  text: string,
  desired: Record<string, string>,
): ReconcileResult {
  let out = text;
  let changed = false;
  const conflicts: string[] = [];

  for (const [id, content] of Object.entries(desired)) {
    const block = findBlock(out, id);

    if (!block) {
      out = appendBlock(out, id, content);
      changed = true;
      continue;
    }
    if (blockStatus(block) === "user-edited") {
      conflicts.push(id);
      continue; // never clobber a user edit (D10)
    }
    if (block.content !== content) {
      out = out.slice(0, block.start) + renderBlock(id, content) + out.slice(block.end);
      changed = true;
    }
  }

  return { text: out, changed, conflicts };
}

function appendBlock(text: string, id: string, content: string): string {
  const block = renderBlock(id, content);
  if (text.length === 0) return `${block}\n`;
  const sep = text.endsWith("\n") ? "\n" : "\n\n";
  return `${text}${sep}${block}\n`;
}
