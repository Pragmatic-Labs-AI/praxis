import { describe, expect, it } from "vitest";
import { reconcileCodexMarketplace, type CodexPluginEntry } from "../src/codex-marketplace.js";

const PONYTAIL: CodexPluginEntry = {
  name: "ponytail",
  source: { source: "url", url: "https://github.com/DietrichGebert/ponytail.git", ref: "v4.7.0" },
  policy: { installation: "INSTALLED_BY_DEFAULT", authentication: "ON_INSTALL" },
  category: "Developer Tools",
};

describe("Codex marketplace reconciliation", () => {
  it("creates pinned metadata and is a second-run no-op", () => {
    const first = reconcileCodexMarketplace("", "", [PONYTAIL]);
    expect(JSON.parse(first.marketplaceText).plugins).toEqual([PONYTAIL]);
    const second = reconcileCodexMarketplace(first.marketplaceText, first.stateText, [PONYTAIL]);
    expect(second.marketplaceChanged).toBe(false);
    expect(second.stateChanged).toBe(false);
  });

  it("preserves user entries while updating and removing intact managed entries", () => {
    const first = reconcileCodexMarketplace("", "", [PONYTAIL]);
    const catalog = JSON.parse(first.marketplaceText);
    catalog.plugins.unshift({ name: "user-plugin", source: "./plugins/user" });
    const removed = reconcileCodexMarketplace(`${JSON.stringify(catalog, null, 2)}\n`, first.stateText, []);
    expect(JSON.parse(removed.marketplaceText).plugins).toEqual([
      { name: "user-plugin", source: "./plugins/user" },
    ]);
  });

  it("conflicts instead of overwriting a user-edited managed entry", () => {
    const first = reconcileCodexMarketplace("", "", [PONYTAIL]);
    const catalog = JSON.parse(first.marketplaceText);
    catalog.plugins[0].category = "My category";
    const edited = `${JSON.stringify(catalog, null, 2)}\n`;
    const result = reconcileCodexMarketplace(edited, first.stateText, [PONYTAIL]);
    expect(result.conflicts).toEqual(["ponytail"]);
    expect(JSON.parse(result.marketplaceText).plugins[0].category).toBe("My category");
  });

  it("adopts an exact desired entry without state but conservatively conflicts on a differing one", () => {
    const exact = `${JSON.stringify({ name: "custom", plugins: [PONYTAIL] }, null, 2)}\n`;
    expect(reconcileCodexMarketplace(exact, "", [PONYTAIL]).conflicts).toEqual([]);
    const changed = JSON.parse(exact);
    changed.plugins[0].category = "Changed";
    expect(reconcileCodexMarketplace(`${JSON.stringify(changed)}\n`, "", [PONYTAIL]).conflicts).toEqual(["ponytail"]);
  });

  it("tolerates a cosmetic key reorder of a managed entry (e.g. a formatter run)", () => {
    const first = reconcileCodexMarketplace("", "", [PONYTAIL]);
    const catalog = JSON.parse(first.marketplaceText);
    const [entry] = catalog.plugins;
    catalog.plugins[0] = {
      category: entry.category,
      name: entry.name,
      policy: entry.policy,
      source: { ref: entry.source.ref, source: entry.source.source, url: entry.source.url },
    };
    const reordered = `${JSON.stringify(catalog, null, 2)}\n`;
    const result = reconcileCodexMarketplace(reordered, first.stateText, [PONYTAIL]);
    expect(result.conflicts).toEqual([]);
  });

  it("does not remove entries when ownership state is missing", () => {
    const catalog = `${JSON.stringify({ name: "custom", plugins: [PONYTAIL] }, null, 2)}\n`;
    const result = reconcileCodexMarketplace(catalog, "", []);
    expect(JSON.parse(result.marketplaceText).plugins).toEqual([PONYTAIL]);
  });
});
