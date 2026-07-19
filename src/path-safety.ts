import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

/**
 * Consumer-repo safety contract (docs/wiki/decisions.md D54):
 * every write, delete, or content-read that Praxis performs against a target
 * repo must stay within an approved root — the repo's own cwd for sync/init's
 * managed files, or a package's own directory for the artifacts it declares.
 *
 * A lexical `join`/`resolve` is not enough: a literal `../` segment and a
 * symlink (a directory or the final file itself) both let an otherwise
 * repo-relative path canonicalize somewhere else entirely — and a symlink can
 * be committed to git, so a hostile or merely careless repo tree is enough to
 * trigger it, no shell injection required. `realpath` is the only source of
 * truth for "where does this actually point"; this resolves `relPath` against
 * `root`, canonicalizes, and refuses the whole operation the instant it lands
 * outside `root`.
 *
 * Praxis has no trust override for an escaping path yet (D54):
 * refusal with a hard, agent-readable error is the default rather than a
 * silent best-effort resolve.
 */
export function resolveContained(root: string, relPath: string, context: string): string {
  const abs = join(root, relPath);
  const rootReal = realpathSync(root);

  // Walk up from the lexical join to the nearest ancestor that already exists
  // on disk. There is always at least one — `root` itself always exists (it's
  // the repo/package directory being operated on) — so a write target that
  // doesn't exist yet (the normal case: `mkdirSync(..., {recursive:true})`
  // will create it) is still checked, via whichever ancestor does exist.
  let probe = abs;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break; // filesystem root guard; unreachable in practice
    probe = parent;
  }
  const probeReal = realpathSync(probe);

  const rel = relative(rootReal, probeReal);
  const escapes = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (escapes) {
    throw new Error(
      `Refusing to resolve ${context} "${relPath}": it resolves to "${probeReal}", which escapes ` +
        `the approved root "${rootReal}". A "../" segment or a symlink does not grant an exception — ` +
        `move the real location inside the root, or remove the symlink.`,
    );
  }
  return abs;
}
