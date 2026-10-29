/**
 * GH222 — chemins des nœuds d'un document YAML, pour le moteur générique de diff / merge.
 *
 * Un pas est une clé de mapping (`k`), un élément de liste identifié (`id`, valeur de sa clé
 * d'identité ou forme canonique d'un scalaire) ou une position (`i`, liste sans identité ou plage
 * d'éléments en conflit).
 */

export type PathStep = { k: string } | { id: string } | { i: number }
export type NodePath = PathStep[]

export const key = (k: string): PathStep => ({ k })
export const item = (id: string): PathStep => ({ id })
export const pos = (i: number): PathStep => ({ i })

/** Pointer segment escaping: `~` `/` `]` (a block key ends a marker line `[<key>]`), and a leading
 *  `@` or `#`, which mark an identified item or a position. */
function esc(s: string): string {
  const e = s.replace(/~/g, '~0').replace(/\//g, '~1').replace(/]/g, '~2')
  return e.startsWith('@') ? `~3${e.slice(1)}` : e.startsWith('#') ? `~4${e.slice(1)}` : e
}

/** JSON-pointer-like key of a path (RFC 6901 escaping, plus `@<id>` and `#<index>` segments). */
export function pointer(path: NodePath): string {
  return path.map(s => '/' + ('k' in s ? esc(s.k) : 'id' in s ? `@${esc(s.id)}` : `#${s.i}`)).join('')
}

/** Literal segments of a path, `*` for items and positions — for pattern matching. */
export function segments(path: NodePath): string[] {
  return path.map(s => ('k' in s ? s.k : '*'))
}

/** `pattern` like `fields/*` matches a path of the same length, `*` matching any step. */
export function matches(pattern: string, path: NodePath): boolean {
  const parts = pattern === '' ? [] : pattern.split('/')
  if (parts.length !== path.length) return false
  return parts.every((p, i) => p === '*' || ('k' in path[i] && (path[i] as { k: string }).k === p))
}
