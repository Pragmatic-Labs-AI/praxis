import { describe, expect, it } from "vitest";
import { buildProgram, previousWizardStep } from "../src/program.js";

// Behavioral unit test. The command-surface invariant lives in
// conformance/cli-surface.conformance.test.ts, not here.
describe("praxis CLI", () => {
  it("is named praxis", () => {
    expect(buildProgram().name()).toBe("praxis");
  });

  it("collects repeated --target values for non-interactive initialization", () => {
    const init = buildProgram().commands.find((command) => command.name() === "init")!;
    init.parseOptions(["--yes", "--target", "codex", "--target", "agents-md"]);
    expect(init.opts()).toMatchObject({ yes: true, target: ["codex", "agents-md"] });
  });

  it("moves backward through each interactive decision step", () => {
    expect(previousWizardStep("stacks", "customize")).toBe("mode");
    expect(previousWizardStep("packages", "customize")).toBe("stacks");
    expect(previousWizardStep("targets", "customize")).toBe("packages");
    expect(previousWizardStep("targets", "quick")).toBe("mode");
    expect(previousWizardStep("preview", "customize")).toBe("targets");
  });
});
