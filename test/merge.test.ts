import { describe, expect, it } from "vitest";
import {
  blockStatus,
  findBlock,
  findBlocks,
  hashContent,
  reconcile,
  renderBlock,
} from "../src/merge.js";

// Behavioral unit tests for the merge primitives. The architectural invariants
// (idempotency, byte preservation, conflict-not-clobber) live in
// conformance/merge-engine.conformance.test.ts.
describe("merge primitives", () => {
  it("hashContent is deterministic and content-sensitive", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
  });

  it("renderBlock round-trips through findBlock", () => {
    const text = renderBlock("x", "hello\nworld");
    const block = findBlock(text, "x");
    expect(block?.content).toBe("hello\nworld");
    expect(block?.recordedHash).toBe(hashContent("hello\nworld"));
  });

  it("findBlocks returns every block in document order", () => {
    const text = `${renderBlock("a", "1")}\n\nmiddle\n\n${renderBlock("b", "2")}`;
    expect(findBlocks(text).map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("blockStatus reflects absent / unchanged / user-edited", () => {
    const text = renderBlock("x", "body");
    expect(blockStatus(findBlock(text, "missing"))).toBe("absent");
    expect(blockStatus(findBlock(text, "x"))).toBe("unchanged");
    const edited = text.replace("body", "body!");
    expect(blockStatus(findBlock(edited, "x"))).toBe("user-edited");
  });

  it("reconcile appends an absent block, then is a no-op", () => {
    const r1 = reconcile("# Title\n", { intro: "hi" });
    expect(r1.changed).toBe(true);
    expect(r1.text.startsWith("# Title\n")).toBe(true);
    expect(findBlock(r1.text, "intro")?.content).toBe("hi");

    const r2 = reconcile(r1.text, { intro: "hi" });
    expect(r2.changed).toBe(false);
    expect(r2.text).toBe(r1.text);
  });
});
