#!/usr/bin/env node
// Rewrites README.md's three generated version-pin blocks to the running
// CLI's own version (src/version.ts's praxisVersion(), the single reader of
// that fact). Renderer lives in src/readme-pins.ts; this script is I/O only,
// so it imports the built dist/ output (mirrors package.json's "selfcheck"
// running `node dist/cli.js`).
//
// docs/handoffs/2026-08-04_1133_HANDOFF_readme-version-pin-sync.md

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spliceReadmePins } from "../dist/readme-pins.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = join(repoRoot, "README.md");

const before = readFileSync(readmePath, "utf8");
const after = spliceReadmePins(before);

if (after !== before) {
  writeFileSync(readmePath, after);
  console.log("README.md version pins updated.");
} else {
  console.log("README.md version pins already up to date.");
}
