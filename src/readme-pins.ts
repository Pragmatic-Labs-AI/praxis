import { praxisVersion } from "./version.js";

/**
 * Generated version pins inside README.md (docs/handoffs/2026-08-04_1133_
 * HANDOFF_readme-version-pin-sync.md). README.md is hand-authored product
 * doc, not methodology, so this deliberately does NOT reuse src/merge.ts's
 * `renderBlock` — its marker hardcodes "edit praxis.yaml then run: praxis
 * sync", which would be false here (mirrors src/codex-security.ts's
 * hand-rolled marker instead, with its own instruction text).
 *
 * Three independent blocks, one per copy-pasteable snippet. Each renders its
 * body from `praxisVersion()` — the single reader of this fact (src/version.ts)
 * — so the CI devDependency pin, the non-Node npm-exec pin, and the global
 * install pin can never drift from `package.json` or from each other.
 */

export const README_PIN_IDS = {
  devDependency: "readme-pin-devdependency",
  npmExec: "readme-pin-npm-exec",
  global: "readme-pin-global",
} as const;

function beginMarker(id: string): string {
  return `<!-- praxis:begin ${id} (generated — run: npm run docs:pins) -->`;
}

function endMarker(id: string): string {
  return `<!-- praxis:end ${id} -->`;
}

function devDependencyBody(version: string): string {
  return `\`\`\`jsonc
// package.json
{
  "devDependencies": {
    "@pragmatic-labs/praxis": "${version}"    // exact version, no ^ / ~ range
  },
  "scripts": {
    "praxis:check": "praxis check"
  }
}
\`\`\``;
}

function npmExecBody(version: string): string {
  return `\`\`\`yaml
# .github/workflows/ci.yml (excerpt)
- run: >-
    npm exec --yes
    --package=@pragmatic-labs/praxis@${version}
    -- praxis check
\`\`\``;
}

function globalInstallBody(version: string): string {
  return `\`\`\`bash
npm install --global @pragmatic-labs/praxis@${version}
praxis check
\`\`\``;
}

const RENDERERS: Record<string, (version: string) => string> = {
  [README_PIN_IDS.devDependency]: devDependencyBody,
  [README_PIN_IDS.npmExec]: npmExecBody,
  [README_PIN_IDS.global]: globalInstallBody,
};

/** Every generated block's current-version body, keyed by block id. */
export function renderReadmePins(version: string = praxisVersion()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, render] of Object.entries(RENDERERS)) out[id] = render(version);
  return out;
}

interface LocatedBlock {
  start: number;
  end: number;
  body: string;
}

/** Find one managed block by id. Undefined if either marker is missing. */
function locate(text: string, id: string): LocatedBlock | undefined {
  const begin = new RegExp(`${escapeForRegExp(beginMarker(id))}\\r?\\n`);
  const beginMatch = begin.exec(text);
  if (!beginMatch) return undefined;

  const bodyStart = beginMatch.index + beginMatch[0].length;
  const end = new RegExp(`\\r?\\n${escapeForRegExp(endMarker(id))}`);
  const endMatch = end.exec(text.slice(bodyStart));
  if (!endMatch || endMatch.index === undefined) return undefined;

  return {
    start: beginMatch.index,
    end: bodyStart + endMatch.index + endMatch[0].length,
    body: text.slice(bodyStart, bodyStart + endMatch.index),
  };
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The current on-disk body of a managed block, or undefined if absent. Used
 * by the conformance byte-compare — never writes. */
export function readmePinBody(text: string, id: string): string | undefined {
  return locate(text, id)?.body;
}

/**
 * Rewrite every managed block in `text` to its rendered body for `version`.
 * Errors loudly if any block's marker pair is missing — markers are added to
 * README.md once, by hand; after that, absence means someone deleted one, and
 * silently re-appending would be wrong for a curated landing page.
 */
export function spliceReadmePins(text: string, version: string = praxisVersion()): string {
  let out = text;
  for (const [id, render] of Object.entries(RENDERERS)) {
    const located = locate(out, id);
    if (!located) {
      throw new Error(
        `README.md is missing the "${id}" managed block markers ` +
          `(${beginMarker(id)} / ${endMarker(id)}). They are added once by hand; ` +
          `restore the pair around the pinned snippet, then re-run npm run docs:pins.`,
      );
    }
    const body = render(version);
    if (located.body === body) continue;
    const block = `${beginMarker(id)}\n${body}\n${endMarker(id)}`;
    out = out.slice(0, located.start) + block + out.slice(located.end);
  }
  return out;
}
