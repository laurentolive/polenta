/**
 * GH183 — vue « Constellation » : disposition radiale des exigences et de leurs liens de
 * raffinement (lien exigence ↔ exigence), avec la part de couverture par les tests.
 *
 * Logique pure (pas de DOM ni de React) pour être testée par vitest. La couverture d'une
 * exigence vient de `computeCoverage()` côté main (`api.traceability.matrix`), jamais recalculée
 * ici : on n'en déduit que la part des exigences terminales couvertes sous un nœud, pour l'affichage.
 */

export interface ConstellationInputNode {
  id: string
  title: string
  objectTypeRef: string
  /** Couverture calculée par le moteur de traçabilité : `not_covered` ou absent = non couverte. */
  covered: boolean
}

export interface ConstellationInputLink {
  id: string
  type: string
  sourceId: string
  targetId: string
}

export interface ConstellationNode {
  id: string
  title: string
  objectTypeRef: string
  covered: boolean
  /** Exigences que celle-ci raffine (vers le centre). */
  parents: string[]
  /** Exigences qui la raffinent (vers l'extérieur). */
  children: string[]
  /** Exigence de plus haut niveau dont elle dépend (pétale), elle-même pour une racine. */
  root: string
  /** Profondeur depuis la racine la plus proche (0 = racine). */
  depth: number
  ring: number
  angle: number
  radius: number
  x: number
  y: number
  /** Exigences terminales (sans raffinement) sous ce nœud, lui-même s'il est terminal. */
  leaves: number
  leavesCovered: number
}

export interface ConstellationPetal {
  rootId: string
  start: number
  end: number
}

export interface ConstellationLayout {
  nodes: Map<string, ConstellationNode>
  /** Liens retenus (les deux extrémités sont des exigences connues, sans boucle sur soi). */
  links: ConstellationInputLink[]
  petals: ConstellationPetal[]
  ringRadii: number[]
}

export interface LayoutOptions {
  /** Sens du raffinement : `source` (défaut) = la source du lien raffine sa cible. */
  childIs?: 'source' | 'target'
  /** Rayon de l'anneau intérieur et de l'anneau extérieur. */
  innerRadius?: number
  outerRadius?: number
}

const TAU = Math.PI * 2
const START = -Math.PI / 2
const GAP = 0.05
const MAX_RINGS = 6

const byId = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

export function buildConstellation(
  inputNodes: ConstellationInputNode[],
  inputLinks: ConstellationInputLink[],
  opts: LayoutOptions = {},
): ConstellationLayout {
  const childIs = opts.childIs ?? 'source'
  const inner = opts.innerRadius ?? 170
  const outer = opts.outerRadius ?? 440

  const nodes = new Map<string, ConstellationNode>()
  for (const n of inputNodes) {
    nodes.set(n.id, {
      ...n, parents: [], children: [], root: n.id, depth: 0, ring: 0, angle: 0, radius: 0, x: 0, y: 0, leaves: 1, leavesCovered: 0,
    })
  }

  const links: ConstellationInputLink[] = []
  const seen = new Set<string>()
  for (const l of inputLinks) {
    if (l.sourceId === l.targetId) continue
    const childId = childIs === 'source' ? l.sourceId : l.targetId
    const parentId = childIs === 'source' ? l.targetId : l.sourceId
    const child = nodes.get(childId), parent = nodes.get(parentId)
    if (!child || !parent) continue
    links.push(l)
    const key = `${childId}\u0000${parentId}`
    if (seen.has(key)) continue
    seen.add(key)
    child.parents.push(parentId)
    parent.children.push(childId)
  }
  for (const n of nodes.values()) { n.parents.sort(byId); n.children.sort(byId) }

  // Racines : sans parent. Une boucle sans racine (A raffine B qui raffine A) reçoit une racine
  // arbitraire (plus petit id) pour que chaque nœud trouve sa place.
  const all = [...nodes.values()].sort((a, b) => byId(a.id, b.id))
  const roots = all.filter(n => n.parents.length === 0)
  const placed = new Set<string>()
  const bfs = (starts: ConstellationNode[]) => {
    const queue = [...starts]
    for (const s of starts) { s.depth = 0; s.root = s.id; placed.add(s.id) }
    while (queue.length) {
      const n = queue.shift()!
      for (const cid of n.children) {
        if (placed.has(cid)) continue
        const c = nodes.get(cid)!
        c.depth = n.depth + 1; c.root = n.root; placed.add(cid)
        queue.push(c)
      }
    }
  }
  bfs(roots)
  for (const n of all) {
    if (placed.has(n.id)) continue
    roots.push(n)
    bfs([n])
  }

  // Anneau : avec plusieurs types d'exigence, un anneau par type, rangés par profondeur moyenne
  // (métier au centre, technique au bord) ; avec un seul type, un anneau par profondeur.
  const types = [...new Set(all.map(n => n.objectTypeRef))]
  if (types.length > 1) {
    const mean = new Map(types.map(t => {
      const ofType = all.filter(n => n.objectTypeRef === t)
      return [t, ofType.reduce((s, n) => s + n.depth, 0) / ofType.length]
    }))
    const order = [...types].sort((a, b) => mean.get(a)! - mean.get(b)! || a.localeCompare(b))
    for (const n of all) n.ring = Math.min(order.indexOf(n.objectTypeRef), MAX_RINGS - 1)
  } else {
    for (const n of all) n.ring = Math.min(n.depth, MAX_RINGS - 1)
  }
  const ringCount = Math.max(1, ...all.map(n => n.ring + 1))
  const ringRadii = Array.from({ length: ringCount }, (_, i) =>
    ringCount === 1 ? inner : inner + (outer - inner) * i / (ringCount - 1))

  // Angles : chaque racine reçoit un secteur proportionnel à son anneau le plus peuplé ; les
  // nœuds d'un anneau s'y répartissent régulièrement, rangés près de leur parent.
  const petals: ConstellationPetal[] = []
  const members = new Map<string, ConstellationNode[]>()
  for (const n of all) {
    const list = members.get(n.root)
    if (list) list.push(n); else members.set(n.root, [n])
  }
  const weight = (rootId: string) => {
    const counts = new Map<number, number>()
    for (const n of members.get(rootId) ?? []) counts.set(n.ring, (counts.get(n.ring) ?? 0) + 1)
    return Math.max(1, ...counts.values())
  }
  roots.sort((a, b) => byId(a.id, b.id))
  const gap = roots.length > 1 ? GAP : 0
  const total = roots.reduce((s, r) => s + weight(r.id), 0)
  const usable = TAU - gap * roots.length
  let cursor = START + gap / 2
  for (const r of roots) {
    const span = usable * weight(r.id) / total
    const start = cursor, end = cursor + span
    petals.push({ rootId: r.id, start, end })
    cursor = end + gap
    const mine = members.get(r.id) ?? []
    for (let ring = 0; ring < ringCount; ring++) {
      const onRing = mine.filter(n => n.ring === ring)
      const anchor = (n: ConstellationNode) => {
        const ps = n.parents.map(id => nodes.get(id)!).filter(p => p.root === r.id && p.ring < ring)
        return ps.length ? ps.reduce((s, p) => s + p.angle, 0) / ps.length : (start + end) / 2
      }
      const keyed = onRing.map(n => ({ n, a: anchor(n) })).sort((a, b) => a.a - b.a || byId(a.n.id, b.n.id))
      keyed.forEach(({ n }, i) => { n.angle = start + span * (i + 0.5) / keyed.length })
    }
  }
  for (const n of all) {
    n.radius = ringRadii[n.ring]
    n.x = Math.cos(n.angle) * n.radius
    n.y = Math.sin(n.angle) * n.radius
  }

  // Couverture affichée : part des exigences terminales couvertes sous chaque nœud.
  for (const n of all) {
    const below = descendants(nodes, n.id)
    const leaves = below.size ? [...below].map(id => nodes.get(id)!).filter(d => d.children.length === 0) : [n]
    n.leaves = leaves.length
    n.leavesCovered = leaves.filter(d => d.covered).length
  }

  return { nodes, links, petals, ringRadii }
}

export function descendants(nodes: Map<string, ConstellationNode>, id: string): Set<string> {
  return walk(nodes, id, n => n.children)
}

export function ancestors(nodes: Map<string, ConstellationNode>, id: string): Set<string> {
  return walk(nodes, id, n => n.parents)
}

/** Lignée d'un nœud : lui-même, ce qu'il raffine et ce qui le raffine (de proche en proche). */
export function lineage(nodes: Map<string, ConstellationNode>, id: string): Set<string> {
  return new Set([id, ...ancestors(nodes, id), ...descendants(nodes, id)])
}

function walk(nodes: Map<string, ConstellationNode>, id: string, next: (n: ConstellationNode) => string[]): Set<string> {
  const acc = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const n = nodes.get(stack.pop()!)
    if (!n) continue
    for (const m of next(n)) if (m !== id && !acc.has(m)) { acc.add(m); stack.push(m) }
  }
  return acc
}

/** Courbe d'un lien : quadratique, tirée vers le centre pour dessiner les « pétales ». */
export function linkPath(parent: ConstellationNode, child: ConstellationNode): string {
  let da = child.angle - parent.angle
  while (da > Math.PI) da -= TAU
  while (da < -Math.PI) da += TAU
  const am = parent.angle + da / 2
  const rm = (parent.radius + child.radius) / 2 * 0.78
  return `M${parent.x.toFixed(1)},${parent.y.toFixed(1)} Q${(Math.cos(am) * rm).toFixed(1)},${(Math.sin(am) * rm).toFixed(1)} ${child.x.toFixed(1)},${child.y.toFixed(1)}`
}

/** Arc de cercle de `a1` à `a2` (sens horaire), `reverse` pour un texte lisible en bas du cercle. */
export function arcPath(r: number, a1: number, a2: number, reverse = false): string {
  const large = a2 - a1 > Math.PI ? 1 : 0
  const p = (a: number) => `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`
  return reverse ? `M${p(a2)} A${r},${r} 0 ${large} 0 ${p(a1)}` : `M${p(a1)} A${r},${r} 0 ${large} 1 ${p(a2)}`
}
