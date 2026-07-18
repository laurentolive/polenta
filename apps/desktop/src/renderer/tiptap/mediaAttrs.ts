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
