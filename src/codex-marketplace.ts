import { createHash } from "node:crypto";

export const CODEX_MARKETPLACE_PATH = ".agents/plugins/marketplace.json";
export const CODEX_MARKETPLACE_STATE_PATH = ".praxis/codex-marketplace-state.json";

export interface CodexPluginEntry {
  name: string;
  source: Record<string, string>;
  policy: { installation: string; authentication: string };
  category: string;
}

interface OwnershipState {
  version: 1;
  entries: Record<string, string>;
}

/** Deeply sorts object keys so hashing is insensitive to cosmetic key
 *  reordering (e.g. a formatter running `jq -S` over marketplace.json). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function hashEntry(entry: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(entry))).digest("hex");
}

function parseJson(text: string, label: string): Record<string, unknown> {
  if (!text.trim()) return {};
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseState(text: string): OwnershipState {
  if (!text.trim()) return { version: 1, entries: {} };
  const parsed = parseJson(text, CODEX_MARKETPLACE_STATE_PATH);
  if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== "object" || Array.isArray(parsed.entries)) {
    throw new Error(`${CODEX_MARKETPLACE_STATE_PATH} has an unsupported ownership-state shape.`);
  }
  const entries: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed.entries)) {
    if (typeof value !== "string") throw new Error(`${CODEX_MARKETPLACE_STATE_PATH} has a non-string hash for ${name}.`);
    entries[name] = value;
  }
  return { version: 1, entries };
}

function render(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export interface MarketplaceReconcileResult {
  marketplaceText: string;
  stateText: string;
  marketplaceChanged: boolean;
  stateChanged: boolean;
  conflicts: string[];
}

export function reconcileCodexMarketplace(
  marketplaceText: string,
  stateText: string,
  desired: CodexPluginEntry[],
): MarketplaceReconcileResult {
  const root = parseJson(marketplaceText, CODEX_MARKETPLACE_PATH);
  const state = parseState(stateText);
  const rawPlugins = root.plugins ?? [];
  if (!Array.isArray(rawPlugins)) throw new Error(`${CODEX_MARKETPLACE_PATH} field "plugins" must be an array.`);
  const plugins = [...rawPlugins] as unknown[];
  const conflicts: string[] = [];
  const desiredByName = new Map(desired.map((entry) => [entry.name, entry]));
  const nextHashes: Record<string, string> = {};

  const findIndex = (name: string): number => plugins.findIndex((entry) =>
    Boolean(entry && typeof entry === "object" && !Array.isArray(entry) && (entry as Record<string, unknown>).name === name),
  );

  for (const [name, recordedHash] of Object.entries(state.entries)) {
    const index = findIndex(name);
    const wanted = desiredByName.get(name);
    if (index === -1) continue;
    if (hashEntry(plugins[index]) !== recordedHash) {
      conflicts.push(name);
      nextHashes[name] = recordedHash;
      desiredByName.delete(name);
      continue;
    }
    if (!wanted) {
      plugins.splice(index, 1);
    }
  }

  for (const entry of desired) {
    if (!desiredByName.has(entry.name)) continue;
    const index = findIndex(entry.name);
    const desiredHash = hashEntry(entry);
    if (index === -1) {
      plugins.push(entry);
      nextHashes[entry.name] = desiredHash;
      continue;
    }
    const recordedHash = state.entries[entry.name];
    if (recordedHash || hashEntry(plugins[index]) === desiredHash) {
      plugins[index] = entry;
      nextHashes[entry.name] = desiredHash;
    } else {
      conflicts.push(entry.name);
    }
  }

  for (const [name, recordedHash] of Object.entries(state.entries)) {
    if (conflicts.includes(name)) nextHashes[name] = recordedHash;
  }

  if (!("name" in root)) root.name = "praxis";
  if (!("interface" in root)) root.interface = { displayName: "Praxis" };
  root.plugins = plugins;
  const nextState: OwnershipState = { version: 1, entries: nextHashes };
  const nextMarketplaceText = render(root);
  const nextStateText = render(nextState);
  return {
    marketplaceText: nextMarketplaceText,
    stateText: nextStateText,
    marketplaceChanged: nextMarketplaceText !== marketplaceText,
    stateChanged: nextStateText !== stateText,
    conflicts,
  };
}
