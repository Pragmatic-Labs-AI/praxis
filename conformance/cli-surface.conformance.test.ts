import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/program.js";

/**
 * Conformance: the CLI command surface is a contract.
 *
 * Prior art for conformance tests (see conformance/README.md): a repo invariant
 * whose failure message tells the coding agent what is wrong, where to fix it,
 * and what to follow — "the failing test is the prompt".
 */

// The declared command surface. Source of truth, sorted; mirrored in
// docs/wiki/interaction-model.md and capped by decision D3.
const COMMAND_CONTRACT = ["check", "init", "sync"];

function actualCommands(): string[] {
  return buildProgram()
    .commands.map((c) => c.name())
    .sort();
}

describe("conformance: CLI command surface", () => {
  it("matches the declared command contract", () => {
    const actual = actualCommands();
    const guidance = [
      `The CLI command surface drifted from its declared contract.`,
      `  expected: ${JSON.stringify(COMMAND_CONTRACT)}`,
      `  actual:   ${JSON.stringify(actual)}`,
      ``,
      `Commands are registered in src/program.ts and documented in docs/wiki/interaction-model.md.`,
      `To change the surface, update all three together: src/program.ts, COMMAND_CONTRACT in`,
      `this file, and docs/wiki/interaction-model.md. Decision D3 caps the imperative surface at`,
      `init/sync/check — adding or removing a command needs an architecture decision first.`,
    ].join("\n");
    expect(actual, guidance).toEqual(COMMAND_CONTRACT);
  });

  it("gives every command a description", () => {
    const undescribed = buildProgram()
      .commands.filter((c) => c.description().trim() === "")
      .map((c) => c.name());
    const guidance = [
      `These commands ship with no description: ${JSON.stringify(undescribed)}.`,
      `The description is what users read in \`praxis --help\`; a command without one is`,
      `undocumented. Add \`.description("...")\` to the command in src/program.ts.`,
    ].join("\n");
    expect(undescribed, guidance).toEqual([]);
  });
});
