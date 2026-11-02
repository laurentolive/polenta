import type { TypeTreeNode } from '@polenta/types'

/**
 * GH230 — élément de référence d'une vue Tableau / Document, lu dans son DOM au changement de
 * mode : lignes / cartes / titres portent `data-node-id` (T164), la zone de défilement
 * `data-view-scroll`, les lignes sélectionnées du Tableau `data-selected`.
 */

export function viewScroller(scope: HTMLElement | null): HTMLElement | null {
  return scope?.querySelector<HTMLElement>('[data-view-scroll]') ?? null
}

/** Première ligne sélectionnée du Tableau, dans l'ordre d'affichage. */
export function selectedRowNode(scope: HTMLElement | null): string | null {
  return scope?.querySelector<HTMLElement>('[data-node-id][data-selected]')?.dataset.nodeId ?? null
}

/** Premier nœud accepté affiché en haut de `scroller` : son milieu est sous le haut de la zone
 *  (décalé de son `scroll-margin-top` — en-tête figé du Tableau) et il commence avant le bas. */
export function firstVisibleNode(scroller: HTMLElement, accept: (nodeId: string) => boolean): string | null {
  const area = scroller.getBoundingClientRect()
  for (const el of scroller.querySelectorAll<HTMLElement>('[data-node-id]')) {
    const nodeId = el.dataset.nodeId
    if (!nodeId || !accept(nodeId)) continue
    const rect = el.getBoundingClientRect()
    if (rect.bottom <= area.top) continue
    if (rect.top >= area.bottom) return null
    const top = area.top + (parseFloat(getComputedStyle(el).scrollMarginTop) || 0)
    if ((rect.top + rect.bottom) / 2 >= top) return nodeId
  }
  return null
}

/** Nœuds à essayer, dans l'ordre, quand `nodeId` n'est pas rendu dans la vue : ses ancêtres du
 *  plus proche au plus haut (dossier replié), ses descendants (titres de dossiers masqués), les
 *  nœuds suivants puis les précédents en sens inverse (élément filtré). */
export function scrollCandidates(root: TypeTreeNode[], nodeId: string): string[] {
  const order: string[] = []
  const parents = new Map<string, string>()
  const walk = (nodes: TypeTreeNode[], parent: string | null) => {
    for (const n of nodes) {
      order.push(n.id)
      if (parent) parents.set(n.id, parent)
      walk(n.children, n.id)
    }
  }
  walk(root, null)
  const index = order.indexOf(nodeId)
  if (index < 0) return [nodeId]
  const ancestors: string[] = []
  for (let p = parents.get(nodeId); p; p = parents.get(p)) ancestors.push(p)
  return [nodeId, ...ancestors, ...order.slice(index + 1), ...order.slice(0, index).reverse().filter(id => !ancestors.includes(id))]
}
