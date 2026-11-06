// GH302 / GH305 — comparaison de versions X.Y.Z[-pré], sans dépendance (main, serveur web, renderer).

/** X.Y.Z[-pré] → nombres + pré-version ; `v` initial toléré ; null si illisible. */
function parse(version: string): { nums: number[]; pre: string | null } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(version.trim())
  if (!m) return null
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null }
}

/**
 * `candidate` est-elle plus récente que `current` ? À X.Y.Z égal, une pré-version (build de dev
 * `X.Y.Z-alpha.N`, GH158) est antérieure à la release. Version illisible → false (rien proposé).
 */
export function isNewer(candidate: string, current: string): boolean {
  const a = parse(candidate)
  const b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i]! > b.nums[i]!
  }
  if (a.pre === b.pre) return false
  if (a.pre === null) return true
  if (b.pre === null) return false
  return a.pre.localeCompare(b.pre, 'en', { numeric: true }) > 0
}
