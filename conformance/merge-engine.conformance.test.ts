import { describe, expect, it } from "vitest";
import { findBlock, reconcile, renderBlock } from "../src/merge.js";

/**
 * Conformance: the merge engine upholds the non-negotiables of
 * docs/wiki/merge-engine.md and decisions D7/D10. These invariants ARE the spec for block-splice merge
 * (see conformance/README.md). Each failure message tells the agent what broke,
 * where, and which decision governs the fix.
 */

const HOST = [
  "# My project",
  "",
  "Some hand-written notes the user owns.",
  "",
  renderBlock("karpathy-claude", "RULE ONE\nRULE TWO"),
  "",
  "More user notes below.",
  "",
].join("\n");

const SAME = { "karpathy-claude": "RULE ONE\nRULE TWO" } as const;

describe("conformance: merge engine", () => {
  it("is idempotent — reconciling twice equals reconciling once", () => {
    const once = reconcile(HOST, { ...SAME });
    const twice = reconcile(once.text, { ...SAME });
    const guidance = [
      `reconcile() is not idempotent: a second sync with identical inputs changed the file.`,
      `A no-op sync must produce a byte-identical result (docs/wiki/merge-engine.md, D7).`,
      `In src/merge.ts, renderBlock/findBlock must round-trip exactly and reconcile must skip`,
      `a block whose on-disk content already equals the desired content.`,
    ].join("\n");
    expect(twice.text, guidance).toBe(once.text);
    expect(twice.changed, "second reconcile must report changed=false").toBe(false);
  });

  it("preserves every byte outside managed blocks", () => {
    const result = reconcile(HOST, { ...SAME });
    const guidance = [
      `Content outside praxis-managed blocks was modified.`,
      `Merge must splice only the marked span and touch nothing else (docs/wiki/merge-engine.md) —`,
      `never re-serialize the host file. Check reconcile()/appendBlock in src/merge.ts for`,
      `accidental trimming or normalization.`,
    ].join("\n");
    expect(result.text, guidance).toBe(HOST);
  });

  it("never clobbers a user edit inside a managed block (conflict, not overwrite)", () => {
    const edited = HOST.replace("RULE TWO", "RULE TWO (user changed this)");
    const result = reconcile(edited, { ...SAME });
    const guidance = [
      `A user edit inside a managed block was overwritten — D10 forbids this.`,
      `When the on-disk content hash != the hash recorded in the begin marker, the user edited`,
      `managed content. Praxis must report a conflict and leave the bytes untouched. See`,
      `blockStatus()/reconcile() in src/merge.ts.`,
    ].join("\n");
    expect(result.text, guidance).toBe(edited);
    expect(
      result.conflicts,
      "the edited block id must be reported as a conflict",
    ).toContain("karpathy-claude");
  });

  it("finds and updates a block the user has relocated in the file", () => {
    const block = findBlock(HOST, "karpathy-claude");
    expect(block, "fixture must contain the block").toBeDefined();
    const span = HOST.slice(block!.start, block!.end);
    const moved = `${span}\n\n${HOST.slice(0, block!.start)}${HOST.slice(block!.end)}`;

    const result = reconcile(moved, { "karpathy-claude": "RULE ONE\nRULE THREE" });
    const guidance = [
      `A managed block was located by position, not by marker.`,
      `Blocks must be found by their begin/end markers wherever they sit in the file`,
      `(docs/wiki/merge-engine.md: "found by marker, not by position"). Check the findBlocks() regex.`,
    ].join("\n");
    expect(findBlock(result.text, "karpathy-claude")?.content, guidance).toBe(
      "RULE ONE\nRULE THREE",
    );
  });

  it("treats block content as opaque — no normalization of prose", () => {
    const messy = "* star bullet\n*   ragged   spacing  \n\n\ttab-indented line";
    const text = renderBlock("notes", messy);
    const result = reconcile(text, { notes: messy });
    const guidance = [
      `Managed content was normalized. Block content is opaque text and must round-trip`,
      `byte-for-byte — this is exactly what a markdown AST got wrong (D7). Do not parse or`,
      `re-emit content; hash and store it verbatim. Check renderBlock()/findBlock().`,
    ].join("\n");
    expect(findBlock(result.text, "notes")?.content, guidance).toBe(messy);
    expect(result.changed, "unchanged opaque content must be a no-op").toBe(false);
  });
});
