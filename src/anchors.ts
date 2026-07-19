import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { memberName, type Workspace } from "./manifest.js";

/**
 * Deterministic knowledge-anchor checks for D26 Tier 2.
 *
 * Anchors live in markdown frontmatter under `praxisAnchors`. They are not a
 * truth check for prose; they only prove that cited repo reality still resolves.
 */

const anchorSchema = z.strictObject({
  type: z.enum(["path", "command", "section"]),
  target: z.string().min(1),
  // Cross-repo anchor (D53): resolve against a workspace member's cloned
  // directory instead of this repo. See `checkAnchors`'s member-anchor
  // semantics below for the hard-fail vs. advisory-skip rules.
  member: z.string().min(1).optional(),
});

const frontmatterSchema = z.object({
  praxisAnchors: z.array(anchorSchema).optional(),
});

export type Anchor = z.infer<typeof anchorSchema>;

export interface AnchorDiagnostic {
  file: string;
  type?: Anchor["type"];
  target?: string;
  message: string;
}

/** A `member:` anchor whose member is declared but not yet cloned (dir missing,
 *  or present without a `.git` entry — mkdir'd, clone failed/incomplete).
 *  Advisory only: recorded here, never a diagnostic, `ok` stays true. */
export interface AnchorSkip {
  file: string;
  member: string;
  target: string;
  reason: string;
}

export interface AnchorCheckReport {
  filesScanned: number;
  anchorsChecked: number;
  diagnostics: AnchorDiagnostic[];
  skipped: AnchorSkip[];
  ok: boolean;
}

interface AnchorFile {
  path: string;
  anchors: Anchor[];
  diagnostics: AnchorDiagnostic[];
}

/** `workspace` is the hub's own `workspace:` config (D53), when declared —
 *  omitting it (the default) reproduces byte-identical pre-workspace behavior:
 *  no anchor in a non-workspace repo carries `member:`, so the branch below
 *  never triggers. */
export function checkAnchors(cwd: string, workspace?: Workspace): AnchorCheckReport {
  const files = listKnowledgeMarkdownFiles(cwd);
  const diagnostics: AnchorDiagnostic[] = [];
  const skipped: AnchorSkip[] = [];
  let anchorsChecked = 0;

  for (const file of files) {
    const parsed = parseAnchorFile(cwd, file);
    diagnostics.push(...parsed.diagnostics);

    for (const anchor of parsed.anchors) {
      if (anchor.member === undefined) {
        anchorsChecked += 1;
        const diagnostic = resolveAnchor(cwd, parsed.path, anchor);
        if (diagnostic) diagnostics.push(diagnostic);
        continue;
      }

      const member = resolveMemberBase(cwd, workspace, anchor.member);
      if (member.kind === "skip") {
        skipped.push({ file: parsed.path, member: anchor.member, target: anchor.target, reason: member.reason });
        continue;
      }

      anchorsChecked += 1;
      if (member.kind === "hard-fail") {
        diagnostics.push(diagnostic(parsed.path, anchor, member.message));
        continue;
      }
      const result = resolveAnchor(member.base, parsed.path, anchor);
      if (result) diagnostics.push(result);
    }
  }

  return {
    filesScanned: files.length,
    anchorsChecked,
    diagnostics,
    skipped,
    ok: diagnostics.length === 0,
  };
}

type MemberResolution =
  | { kind: "base"; base: string }
  | { kind: "skip"; reason: string }
  | { kind: "hard-fail"; message: string };

/** Member-anchor semantics (D53):
 *  1. No workspace declared at all -> hard-fail (anchor references a member
 *     but this repo declares no workspace).
 *  2. Member name not declared -> hard-fail (typo; actionable, lists what's
 *     actually declared — mirrors packages.ts's `resolve()` style).
 *  3. Member declared but its dir is missing, or exists without a `.git` entry
 *     (mkdir'd, clone failed/incomplete) -> advisory skip; `ok` stays true.
 *  4. Member dir exists with `.git` -> resolve against it like a local anchor. */
function resolveMemberBase(cwd: string, workspace: Workspace | undefined, wantedMember: string): MemberResolution {
  if (workspace === undefined) {
    return {
      kind: "hard-fail",
      message: `anchor names member "${wantedMember}" but this repo declares no workspace in praxis.yaml`,
    };
  }

  const member = workspace.members.find((m) => memberName(m) === wantedMember);
  if (member === undefined) {
    const declared = workspace.members.map((m) => memberName(m)).sort().join(", ") || "(none)";
    return {
      kind: "hard-fail",
      message: `anchor names member "${wantedMember}", which praxis.yaml's workspace does not declare. Declared members: ${declared}.`,
    };
  }

  const base = join(cwd, member.path);
  if (!existsSync(base) || !existsSync(join(base, ".git"))) {
    return { kind: "skip", reason: `member "${wantedMember}" not cloned` };
  }
  return { kind: "base", base };
}

export function parseAnchorsFromMarkdown(file: string, text: string): AnchorFile {
  const frontmatter = readFrontmatter(text);
  if (frontmatter === undefined) return { path: file, anchors: [], diagnostics: [] };

  let raw: unknown;
  try {
    raw = parseYaml(frontmatter);
  } catch (err) {
    return {
      path: file,
      anchors: [],
      diagnostics: [{ file, message: `frontmatter is not valid YAML: ${(err as Error).message}` }],
    };
  }

  const result = frontmatterSchema.safeParse(raw ?? {});
  if (!result.success) {
    return {
      path: file,
      anchors: [],
      diagnostics: result.error.issues.map((issue) => ({
        file,
        message: `invalid praxisAnchors metadata at ${issue.path.map(String).join(".")}: ${issue.message}`,
      })),
    };
  }

  return { path: file, anchors: result.data.praxisAnchors ?? [], diagnostics: [] };
}

function parseAnchorFile(cwd: string, file: string): AnchorFile {
  return parseAnchorsFromMarkdown(file, readFileSync(join(cwd, file), "utf8"));
}

function resolveAnchor(cwd: string, file: string, anchor: Anchor): AnchorDiagnostic | undefined {
  if (anchor.type === "path") return resolvePathAnchor(cwd, file, anchor);
  if (anchor.type === "command") return resolveCommandAnchor(cwd, file, anchor);
  return resolveSectionAnchor(cwd, file, anchor);
}

function resolvePathAnchor(cwd: string, file: string, anchor: Anchor): AnchorDiagnostic | undefined {
  const target = safeRepoTarget(cwd, anchor.target);
  if (target === undefined) {
    return diagnostic(file, anchor, "path anchor must be a repo-relative path without '..'");
  }
  if (!existsSync(target.abs)) {
    return diagnostic(file, anchor, `path does not exist: ${anchor.target}`);
  }
  return undefined;
}

function resolveCommandAnchor(cwd: string, file: string, anchor: Anchor): AnchorDiagnostic | undefined {
  const script = npmScriptName(anchor.target);
  if (script === undefined) {
    return diagnostic(file, anchor, `unsupported command anchor: ${anchor.target}`);
  }

  let pkg: unknown;
  try {
    pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  } catch {
    return diagnostic(file, anchor, "package.json is missing or invalid");
  }

  const scripts = z.object({ scripts: z.record(z.string(), z.string()).optional() }).safeParse(pkg);
  if (!scripts.success || scripts.data.scripts?.[script] === undefined) {
    return diagnostic(file, anchor, `package.json has no "${script}" script`);
  }
  return undefined;
}

function resolveSectionAnchor(cwd: string, file: string, anchor: Anchor): AnchorDiagnostic | undefined {
  const [path, hash, extra] = anchor.target.split("#");
  if (!path || !hash || extra !== undefined) {
    return diagnostic(file, anchor, "section anchor must look like docs/file.md#heading-slug");
  }

  const target = safeRepoTarget(cwd, path);
  if (target === undefined) {
    return diagnostic(file, anchor, "section anchor path must be repo-relative and without '..'");
  }
  if (!existsSync(target.abs)) {
    return diagnostic(file, anchor, `section file does not exist: ${path}`);
  }

  const headings = markdownHeadingSlugs(readFileSync(target.abs, "utf8"));
  if (!headings.has(hash)) {
    return diagnostic(file, anchor, `section does not exist: ${anchor.target}`);
  }
  return undefined;
}

function diagnostic(file: string, anchor: Anchor, message: string): AnchorDiagnostic {
  return { file, type: anchor.type, target: anchor.target, message };
}

function npmScriptName(command: string): string | undefined {
  const run = command.match(/^npm run ([A-Za-z0-9:_-]+)$/);
  if (run?.[1]) return run[1];

  const direct = command.match(/^npm ([A-Za-z0-9:_-]+)$/);
  if (direct?.[1]) return direct[1];

  return undefined;
}

function markdownHeadingSlugs(text: string): Set<string> {
  const slugs = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match?.[2]) slugs.add(slugifyHeading(match[2]));
  }
  return slugs;
}

function slugifyHeading(heading: string): string {
  return heading
    .replace(/`([^`]+)`/g, "$1")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function safeRepoTarget(cwd: string, target: string): { abs: string; rel: string } | undefined {
  if (isAbsolute(target)) return undefined;
  const parts = target.split(/[\\/]+/);
  if (parts.includes("..")) return undefined;

  const abs = join(cwd, ...parts);
  const rel = relative(cwd, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return { abs, rel: rel.split(sep).join("/") };
}

function readFrontmatter(text: string): string | undefined {
  // Windows checkouts: tolerate a UTF-8 BOM and CRLF line endings, or the
  // frontmatter silently disappears and every anchor in the file goes unchecked.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const open = text.match(/^---\r?\n/);
  if (open === null) return undefined;
  const end = text.indexOf("\n---", open[0].length);
  if (end === -1) return undefined;
  const after = text[end + 4];
  if (after !== "\n" && after !== "\r" && after !== undefined) return undefined;
  // The final line's \r (CRLF) would otherwise leak into the last YAML scalar.
  return text.slice(open[0].length, end).replace(/\r$/, "");
}

// Hub-sovereign (D53): scans only this repo's own knowledge surface. A member's
// wiki/CLAUDE.md/etc. is that member's own concern, checked by that member's
// own `praxis check` when it runs standalone — the hub never reaches into a
// member's markdown here, only into member anchor *targets* declared in its
// own files via `member:`.
function listKnowledgeMarkdownFiles(cwd: string): string[] {
  return [
    ...["CLAUDE.md", "MEMORY.md", "USER.md"].filter((file) => existsSync(join(cwd, file))),
    ...listMarkdownUnder(cwd, "docs/wiki"),
    ...listMarkdownUnder(cwd, "docs/proposals"),
  ].sort();
}

function listMarkdownUnder(cwd: string, root: string): string[] {
  const absRoot = join(cwd, root);
  if (!existsSync(absRoot)) return [];

  const files: string[] = [];
  for (const entry of readdirSync(absRoot, { withFileTypes: true })) {
    const rel = `${root}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listMarkdownUnder(cwd, rel));
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(rel);
  }
  return files;
}
