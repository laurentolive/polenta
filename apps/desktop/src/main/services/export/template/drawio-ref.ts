import { parseMarkdown } from './markdown'

/** Diagramme référencé par un bloc ```` ```drawio ```` (SPEC-REQ §3.2a). */
export interface DrawioRef {
  path: string
  nodeId: string | null
  width: number | null
  height: number | null
  /** Rognage, en unités de la taille naturelle du diagramme (cf. `computeDrawioLayout`). */
  crop: { x: number; y: number; width: number; height: number } | null
}

/** Image d'un diagramme : PNG haute définition et taille d'affichage (px CSS, comme à l'écran). */
export interface DrawioSnapshot {
  png: Buffer
  width: number
  height: number
}

/** Rend des diagrammes en images ; un diagramme en échec est absent du résultat. */
export type DrawioSnapshotter = (repoPath: string, refs: DrawioRef[]) => Promise<Map<string, DrawioSnapshot>>

/** Clé de dédoublonnage : même fichier, même ancre, même taille, même rognage → même image. */
export function drawioKey(ref: DrawioRef): string {
  return JSON.stringify([ref.path, ref.nodeId, ref.width, ref.height, ref.crop])
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** Contenu JSON d'un bloc drawio → référence ; `null` si illisible ou sans chemin. */
export function parseDrawioFence(content: string): DrawioRef | null {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(content.trim()) as Record<string, unknown>
  } catch {
    return null
  }
  if (!parsed || typeof parsed.path !== 'string' || !parsed.path) return null
  const c = parsed.crop as Record<string, unknown> | undefined
  const crop = c && typeof c.x === 'number' && typeof c.y === 'number' && positive(c.width) && positive(c.height)
    ? { x: c.x, y: c.y, width: c.width as number, height: c.height as number }
    : null
  return {
    path: parsed.path,
    nodeId: typeof parsed.nodeId === 'string' && parsed.nodeId ? parsed.nodeId : null,
    width: positive(parsed.width),
    height: positive(parsed.height),
    crop,
  }
}

/**
 * Tous les diagrammes référencés dans les textes d'un payload d'export (parcours récursif), pour
 * les rendre en une seule passe avant la conversion des champs richtext.
 */
export function collectDrawioRefs(payload: unknown): DrawioRef[] {
  const refs: DrawioRef[] = []
  const seen = new Set<unknown>()
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      if (!value.includes('```drawio')) return
      for (const token of parseMarkdown(value)) {
        if (token.type !== 'fence' || token.info.trim() !== 'drawio') continue
        const ref = parseDrawioFence(token.content)
        if (ref) refs.push(ref)
      }
    } else if (value && typeof value === 'object' && !seen.has(value)) {
      seen.add(value)
      for (const child of Object.values(value)) visit(child)
    }
  }
  visit(payload)
  return refs
}
