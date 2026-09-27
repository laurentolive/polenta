/**
 * T176 — offset, dans la valeur brute d'une cellule texte, du caractère le plus proche du point
 * (x, y) de son rendu lecture. Calculé AVANT de monter l'éditeur (un `<textarea>` n'expose pas de
 * « caret from point »). Une référence de paramètre (`[data-param-ref]`, T171) affiche sa valeur
 * mais compte pour sa forme brute `{nom}` (`data-param-raw`) ; un point à l'intérieur se cale avant
 * ou après selon la moitié la plus proche. `null` si le point n'est pas dans le texte.
 *
 * `caretRangeFromPoint` plutôt que `caretPositionFromPoint` : ce dernier n'existe qu'à partir de
 * Chromium 128 (Electron 31 = Chromium 126).
 */
export function rawOffsetAtPoint(container: HTMLElement, x: number, y: number): number | null {
  const range = document.caretRangeFromPoint?.(x, y)
  if (!range || !container.contains(range.startContainer)) return null

  // Point de caret normalisé en (nœud texte, offset) : un caret sur un élément désigne l'enfant
  // d'index `offset` — on vise alors le premier nœud texte à partir de cet enfant.
  let target: Node | null = range.startContainer
  let targetOffset = range.startOffset
  if (target.nodeType !== Node.TEXT_NODE) {
    const child: Node | undefined = target.childNodes[targetOffset]
    target = child ? firstTextFrom(child, container) : null
    targetOffset = 0
  }

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let total = 0
  let lastRef: HTMLElement | null = null
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const ref = (node.parentElement?.closest('[data-param-ref]') ?? null) as HTMLElement | null
    const inRef = ref && container.contains(ref) ? ref : null
    const len = node.textContent?.length ?? 0
    if (node === target) {
      if (!inRef) return total + targetOffset
      const rawLen = inRef.dataset.paramRaw?.length ?? (inRef.textContent?.length ?? 0)
      const refText = inRef.textContent?.length ?? 0
      // Déjà compté si ce n'est pas le premier nœud texte de la référence.
      const base = lastRef === inRef ? total - rawLen : total
      return targetOffset * 2 < refText ? base : base + rawLen
    }
    if (inRef) {
      if (lastRef !== inRef) {
        total += inRef.dataset.paramRaw?.length ?? (inRef.textContent?.length ?? 0)
        lastRef = inRef
      }
    } else {
      total += len
    }
  }
  // Caret après le dernier nœud texte (ex. clic dans le vide sous le texte).
  return total
}

function firstTextFrom(start: Node, container: HTMLElement): Node | null {
  if (start.nodeType === Node.TEXT_NODE) return start
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (start.contains(node) || (start.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) return node
  }
  return null
}
