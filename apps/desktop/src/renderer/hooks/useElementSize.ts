import { useEffect, useState } from 'react'

export interface ElementSize {
  width: number
  height: number
}

/**
 * GH435 — taille (px entiers) du contenu d'un élément, suivie par un `ResizeObserver`.
 *
 * Renvoie une référence « callback » (à poser sur l'élément, qu'il soit monté tout de suite ou plus tard :
 * une grille vide devient pleine sans que le hook ne manque l'élément) et la taille mesurée, `null` tant que
 * l'élément n'est pas mesuré. La première mesure est immédiate ; ensuite, avec `intervalMs`, au plus une mise
 * à jour par intervalle (début et fin d'une rafale) : un redessin coûteux pendant un glissement est ainsi
 * borné, et la dernière taille est toujours appliquée.
 */
export function useElementSize<T extends HTMLElement>(intervalMs = 0): [(el: T | null) => void, ElementSize | null] {
  const [el, setEl] = useState<T | null>(null)
  const [size, setSize] = useState<ElementSize | null>(null)

  useEffect(() => {
    if (!el) {
      setSize(null)
      return
    }
    let last = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let pending: ElementSize | null = null
    const commit = (next: ElementSize) => {
      last = Date.now()
      pending = null
      setSize((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next))
    }
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1].contentRect
      const next = { width: Math.round(box.width), height: Math.round(box.height) }
      const wait = last + intervalMs - Date.now()
      if (intervalMs <= 0 || wait <= 0) {
        if (timer) clearTimeout(timer)
        timer = null
        commit(next)
        return
      }
      pending = next
      timer ??= setTimeout(() => {
        timer = null
        if (pending) commit(pending)
      }, wait)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [el, intervalMs])

  return [setEl, size]
}
