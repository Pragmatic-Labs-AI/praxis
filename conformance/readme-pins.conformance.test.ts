import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { README_PIN_IDS, readmePinBody, renderReadmePins } from "../src/readme-pins.js";

/**
 * Conformance: README.md's three copy-pasteable version pins (devDependency,
 * npm-exec, global install) must never drift from the running CLI's own
 * version (docs/wiki/workflows.md, "Bumping the version").
 *
 * README.md hardcoding a stale `@pragmatic-labs/praxis@<old>` pin is not a
 * cosmetic nit: `praxis check`'s methodology-pin enforcement (D59/D60/D61)
 * refuses a CLI/pin mismatch in either direction, so a stale README pin
 * produces a devDependency install that `praxis check` immediately rejects.
 *
 * Byte-compares the rendered block (src/readme-pins.ts, the single renderer)
 * against what is actually committed — deterministic regenerate-then-compare,
 * not a regex heuristic, so historical/illustrative mentions elsewhere in the
 * repo (CHANGELOG.md's 0.2.0 upgrade note, the `methodology: "0.1.0"` samples)
 * are excluded by construction rather than by a maintained exception list.
 */

const README_PATH = new URL("../README.md", import.meta.url);

describe("conformance: README.md version pins match the running CLI", () => {
  it("every generated block is byte-identical to its rendered body", () => {
    const readme = readFileSync(README_PATH, "utf8");
    const rendered = renderReadmePins();

    for (const [name, id] of Object.entries(README_PIN_IDS)) {
      const guidance = [
        `README.md's "${id}" block (${name}) does not match the rendered pin for the`,
        `running CLI version. Run \`npm run docs:pins\` to regenerate it — never`,
        `hand-edit the version inside a "praxis:begin ${id}" / "praxis:end ${id}" block.`,
      ].join("\n");

      expect(readmePinBody(readme, id), guidance).toBe(rendered[id]);
    }
  });
});
