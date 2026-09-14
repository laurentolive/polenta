// Utilitaires partagés entre ResizableImageExtension.ts et
// DrawioEmbedExtension.ts : parsing du rectangle de rognage stocké en
// attribut, et échappement pour un attribut HTML sérialisé dans un bloc
// Markdown fenced (mêmes règles pour les deux extensions).
export interface CropRectAttr {
  x: number
  y: number
  width: number
  height: number
}

export function parseCropAttr(value: unknown): CropRectAttr | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Record<string, unknown>
  if (typeof c.x !== 'number' || typeof c.y !== 'number' || typeof c.width !== 'number' || typeof c.height !== 'number') return null
  return { x: c.x, y: c.y, width: c.width, height: c.height }
}

export interface DrawioFencePayload {
  path: string
  nodeId: string | null
  width: number | null
  height: number | null
  crop: CropRectAttr | null
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Contenu d'un bloc *fenced* ```` ```drawio ````  — JSON
 * `{path, nodeId?, width?, height?, crop?}` (cf. DrawioEmbedExtension.serialize).
 * Contenu non-JSON (édition manuelle) : traité comme un chemin brut sans ancre.
 * Partagé entre le parseur markdown-it de l'éditeur (DrawioEmbedExtension) et
 * celui du viewer statique (staticRichText) — une seule définition à faire
 * évoluer si le payload change.
 */
export function parseDrawioFencePayload(raw: string): DrawioFencePayload {
  const content = raw.trim()
  try {
    const p = JSON.parse(content) as Record<string, unknown>
    return {
      path: typeof p.path === 'string' ? p.path : '',
      nodeId: typeof p.nodeId === 'string' && p.nodeId ? p.nodeId : null,
      width: positiveNumber(p.width),
      height: positiveNumber(p.height),
      crop: parseCropAttr(p.crop),
    }
  } catch {
    return { path: content, nodeId: null, width: null, height: null, crop: null }
  }
}
