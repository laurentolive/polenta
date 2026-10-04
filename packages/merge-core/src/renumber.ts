/**
 * GH37 sprint 3 — « Garder les deux » : un objet créé des deux côtés avec le même ID n'existe pas
 * dans l'ancêtre commun, donc toute occurrence de cet ID côté gauche désigne l'objet de gauche.
 * Le côté gauche est réécrit (contenus et chemins), l'objet de droite garde l'ID.
 */

/** `<PREFIX>-XXXX` — the one ID format (GH20), shared with `id-counter.util.ts`. */
export function formatCounterId(prefix: string, num: number): string {
  return `${prefix}-${String(num).padStart(4, '0')}`
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-ID occurrences only: `SYS-0043` but not `SYS-00431`, `XSYS-0043` nor `MC-SYS-0043` (a
 *  prefix may itself contain dashes, so a `-` before the ID means another ID). `TEST-0012-2` (a
 *  campaign `entryId`, ID + instance suffix) does contain the ID and is renumbered too. */
function idPattern(oldId: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(oldId)}(?![0-9A-Za-z_])`, 'g')
}

export function renumberText(text: string, oldId: string, newId: string): string {
  return text.replace(idPattern(oldId), newId)
}

/** Renames every path segment that is the ID itself or `<ID>.<ext>`. */
export function renumberPath(path: string, oldId: string, newId: string): string {
  return path
    .split('/')
    .map(seg => (seg === oldId ? newId : seg.startsWith(`${oldId}.`) ? newId + seg.slice(oldId.length) : seg))
    .join('/')
}

/**
 * Next free ID of `prefix` given every path known on any side (object files and tombstones —
 * GH20: an ID present anywhere, even deleted, is never issued again) and IDs already handed out.
 */
export function nextFreeId(prefix: string, paths: Iterable<string>, issued: Iterable<string> = []): string {
  const re = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)(?:\\.[^/]*)?$`)
  let max = 0
  for (const p of [...paths, ...issued]) {
    const m = re.exec(p.split('/').pop() ?? '')
    if (m) max = Math.max(max, Number(m[1]))
  }
  return formatCounterId(prefix, max + 1)
}

/** Display form of a ref: `refs/remotes/origin/main` → `origin/main`, `refs/heads/x` → `x`. */
export function shortRef(ref: string): string {
  return ref.replace(/^refs\/(heads|remotes)\//, '')
}

/** `SYS-0043` → `SYS` (everything before the last `-<digits>`). */
export function prefixOf(id: string): string | null {
  const m = /^(.*)-\d+$/.exec(id)
  return m ? m[1] : null
}
