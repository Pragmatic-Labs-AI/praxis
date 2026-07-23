import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The single reader for "what version is this CLI build" (A1). Both
 * program.ts's `.version()` CLI surface and the methodology resolver
 * (src/methodology.ts) import this rather than each computing their own —
 * two independently-computed reads of the same fact is exactly the drift
 * that left `METHODOLOGY_VERSION` (formerly src/manifest.ts) stuck at
 * "0.1.0" while package.json moved on.
 *
 * Resolves the same from src/ (dev/vitest) and dist/ (built/installed) —
 * both one level under repo root (mirrors src/packages.ts's PACKAGES_DIR).
 */

/** This CLI's own version, read from its shipped package.json (falls back to "unknown"). */
export function praxisVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
    const version = (pkg as { version?: unknown }).version;
    return typeof version === "string" ? version : "unknown";
  } catch {
    return "unknown";
  }
}
