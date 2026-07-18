// Résolution d'ancre + utilitaire d'échappement pour l'embed draw.io dans
// richtext. Le rendu visuel lui-même est délégué au viewer officiel draw.io
// vendoré (voir drawioViewerLoader.ts) — ce fichier ne contient plus de
// moteur de rendu maison (abandonné au profit d'une fidélité réelle avec
// draw.io, cf. specs/T47-sprint3.md).

export interface DrawioTarget {
  pageIndex: number
  highlightCellId?: string
}

/**
 * Résout une ancre optionnelle (#page-id ou #mxCell-id) vers la page à afficher.
 * - nodeId absent → première page.
 * - nodeId correspondant à l'id d'une page → cette page, pas de surlignage.
 * - nodeId correspondant à l'id d'une cellule trouvée dans une page → cette page,
 *   avec la cellule surlignée.
 * - nodeId ne correspondant à rien → première page (ancre ignorée), pas d'erreur.
 */
export function resolveDrawioTarget(
  pages: { id: string; xml: string }[],
  nodeId?: string,
): DrawioTarget {
  if (!nodeId || pages.length === 0) return { pageIndex: 0 }
  const pageIndex = pages.findIndex(p => p.id === nodeId)
  if (pageIndex !== -1) return { pageIndex }
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].xml.includes(`id="${nodeId}"`)) {
      return { pageIndex: i, highlightCellId: nodeId }
    }
  }
  return { pageIndex: 0 }
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
