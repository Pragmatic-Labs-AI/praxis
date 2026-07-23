import { praxisVersion } from "../src/version.js";

/**
 * The running Praxis CLI's own version — what manifest fixtures across test/
 * and conformance/ must pin `methodology:` to now that `planEmit` enforces an
 * exact match against it (A1, src/methodology.ts). Never hardcode a version
 * literal in a fixture: it would re-break the moment package.json's version
 * next bumps, exactly the drift A1 exists to catch.
 */
export function currentMethodology(): string {
  return praxisVersion();
}
